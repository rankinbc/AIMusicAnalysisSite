using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Net;
using System.Net.Http.Headers;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 3.3 — signed playback: media endpoints proxy local files as before
// and 302 to a short-lived presigned GET when the object lives in S3 only.
public sealed class MediaDeliveryTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private (HttpClient Client, FakeMultipartObjectStore Store, WebApplicationFactory<Program> Factory) NewClient()
    {
        var store = new FakeMultipartObjectStore();
        var f = _factory.WithWebHostBuilder(b => b.ConfigureServices(s =>
        {
            s.RemoveAll<IMultipartObjectStore>();
            s.AddSingleton<IMultipartObjectStore>(store);
        }));
        // 302s must be observable — never auto-follow to the fake S3 host.
        var client = f.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        return (client, store, f);
    }

    private static async Task<(Guid UserId, Guid VersionId)> SeedVersionAsync(
        WebApplicationFactory<Program> f, HttpClient client, string filePath)
    {
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var (_, versionId) = await TestSeed.SongWithVersionAsync(f, userId);
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var v = await db.SongVersions.SingleAsync(x => x.Id == versionId);
        v.FilePath = filePath;
        await db.SaveChangesAsync();
        return (userId, versionId);
    }

    [SkippableFact]
    public async Task Audio_S3OnlyObject_Redirects_To_Presigned_Get()
    {
        await TestDb.RequireAsync(_factory);

        var (client, store, f) = NewClient();
        var key = $"audio/u/{Guid.NewGuid()}/source.wav";
        var (_, versionId) = await SeedVersionAsync(f, client, key);

        var resp = await client.GetAsync($"/api/versions/{versionId}/audio");
        Assert.Equal(HttpStatusCode.Redirect, resp.StatusCode); // 302, never 301 (NFR5)
        Assert.Contains("fake-s3.test", resp.Headers.Location!.ToString());
        Assert.Contains(key, resp.Headers.Location!.ToString());
        Assert.Single(store.PresignedGets);
        // The Location is a bearer-equivalent grant — intermediaries must not cache it.
        Assert.Contains("no-store", resp.Headers.CacheControl?.ToString() ?? "");
        // Content-Type override rides the presign (attachments stored octet-stream).
        Assert.Equal("audio/wav", store.PresignedGets.First().ContentType);
    }

    [SkippableFact]
    public async Task Audio_LocalFile_Still_Proxies_Bytes()
    {
        await TestDb.RequireAsync(_factory);

        var (client, store, f) = NewClient();
        var key = $"audio/test/{Guid.NewGuid()}/source.wav";
        var (_, versionId) = await SeedVersionAsync(f, client, key);

        using (var scope = f.Services.CreateScope())
        {
            var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
            await storage.WriteAsync(key, new MemoryStream(new byte[64]), "audio/wav");
        }

        var resp = await client.GetAsync($"/api/versions/{versionId}/audio");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        Assert.Equal("audio/wav", resp.Content.Headers.ContentType!.MediaType);
        Assert.Empty(store.PresignedGets); // local-first — no presign minted
    }

    [SkippableFact]
    public async Task Audio_Missing_Everywhere_404s()
    {
        await TestDb.RequireAsync(_factory);

        var (client, store, f) = NewClient();
        store.ObjectExists = false;
        var (_, versionId) = await SeedVersionAsync(f, client, $"audio/u/{Guid.NewGuid()}/source.wav");

        var resp = await client.GetAsync($"/api/versions/{versionId}/audio");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    // Solo fork (task 9): audio streaming is strictly owner-scoped — a second,
    // unrelated user must never see user A's audio, not even a 403 (existence
    // must not leak). Covers both JWT forms StreamAudio accepts: the
    // Authorization header and the ?t= query param (the whitelisted /audio
    // path HTMLMediaElement/EventSource use since they can't set headers).
    [SkippableFact]
    public async Task Audio_Is_NotFound_For_A_Different_User()
    {
        await TestDb.RequireAsync(_factory);

        var (client, _, f) = NewClient();
        var (_, versionId) = await SeedVersionAsync(f, client, $"audio/u/{Guid.NewGuid()}/source.wav");

        var (_, tokenB) = await TestAuth.RegisterAsync(f.CreateClient());

        var bearerClient = f.CreateClient();
        bearerClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenB);
        var bearerResp = await bearerClient.GetAsync($"/api/versions/{versionId}/audio");
        Assert.Equal(HttpStatusCode.NotFound, bearerResp.StatusCode);

        var queryClient = f.CreateClient();
        var queryResp = await queryClient.GetAsync($"/api/versions/{versionId}/audio?t={tokenB}");
        Assert.Equal(HttpStatusCode.NotFound, queryResp.StatusCode);
    }

    [SkippableFact]
    public async Task Als_Download_Redirect_Carries_Download_Name()
    {
        await TestDb.RequireAsync(_factory);

        var (client, store, f) = NewClient();
        var (_, versionId) = await SeedVersionAsync(f, client, $"audio/u/{Guid.NewGuid()}/source.wav");
        var alsKey = $"als/{Guid.NewGuid()}/project.als";
        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var v = await db.SongVersions.SingleAsync(x => x.Id == versionId);
            v.AlsFilePath = alsKey;
            await db.SaveChangesAsync();
        }

        var resp = await client.GetAsync($"/api/versions/{versionId}/als");
        Assert.Equal(HttpStatusCode.Redirect, resp.StatusCode);
        Assert.Contains(alsKey, resp.Headers.Location!.ToString());
        // The reason PresignGetUrl takes a name: Content-Disposition override.
        Assert.Equal("project.als", store.PresignedGets.Single().DownloadName);
    }

    [SkippableFact]
    public async Task Image_S3Only_Redirects_Without_Immutable_Cache_Header()
    {
        await TestDb.RequireAsync(_factory);

        var (client, _, f) = NewClient();
        var key = $"analysis/images/{Guid.NewGuid()}/spectrogram.webp";
        var (userId, versionId) = await SeedVersionAsync(f, client, $"audio/u/{Guid.NewGuid()}/source.wav");

        var jobId = Guid.NewGuid();
        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var v = await db.SongVersions.AsNoTracking().SingleAsync(x => x.Id == versionId);
            db.Analyses.Add(new Analysis
            {
                Id = Guid.NewGuid(),
                JobId = jobId,
                UserId = userId,
                VersionId = versionId,
                SongId = v.SongId,
                FinalJson = "{}",
                SpectrogramImagePath = key,
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var resp = await client.GetAsync($"/api/jobs/{jobId}/images/spectrogram");
        Assert.Equal(HttpStatusCode.Redirect, resp.StatusCode);
        Assert.Contains(key, resp.Headers.Location!.ToString());
        // The 302 target expires in minutes — it must NOT be immutable-cached.
        Assert.DoesNotContain("immutable", resp.Headers.CacheControl?.ToString() ?? "");
    }
}
