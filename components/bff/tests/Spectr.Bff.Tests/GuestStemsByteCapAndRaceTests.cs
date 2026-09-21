using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using Xunit;

namespace Spectr.Bff.Tests;

// Task G1 fix round 1 item 4 (Opus review of 665b39f + c78ee3d): the guest
// stems/reference caps ran AFTER the multipart body was already buffered,
// and parallel stems/stage calls raced each other's read-then-write on
// song_versions.stem_paths_raw. Shares the "DemoAuth" collection with the
// other demo-auth suites.
[Collection("DemoAuth")]
public sealed class GuestStemsByteCapAndRaceTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    // Throws for the lock-unavailable test — a fake at the IDistributedLock
    // seam rather than the whole StackExchange.Redis IConnectionMultiplexer
    // surface (same reasoning as RecordingActionLimiter for IRateLimiter).
    private sealed class ThrowingDistributedLock : IDistributedLock
    {
        public Task<string?> TryAcquireAsync(string key, TimeSpan ttl, CancellationToken ct = default)
            => throw new InvalidOperationException("redis unavailable (test double)");
        public Task ReleaseAsync(string key, string token, CancellationToken ct = default)
            => Task.CompletedTask;
    }

    private WebApplicationFactory<Program> Build(IDistributedLock? distLock = null) =>
        factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Demo:Enabled", "true");
            b.UseSetting("Demo:SnapshotKey", "");
            if (distLock is not null)
            {
                b.ConfigureTestServices(s =>
                {
                    s.RemoveAll<IDistributedLock>();
                    s.AddSingleton(distLock);
                });
            }
        });

    private static async Task<(HttpClient Client, DemoStartResponse Demo)> StartGuestAsync(WebApplicationFactory<Program> f)
    {
        var client = f.CreateClient();
        var resp = await client.PostAsync("/api/auth/demo", null);
        resp.EnsureSuccessStatusCode();
        var body = (await resp.Content.ReadFromJsonAsync<DemoStartResponse>())!;
        client.DefaultRequestHeaders.Authorization = new("Bearer", body.AccessToken);
        return (client, body);
    }

    // A version with NO staged stems yet (existingBytes = 0), owned by the
    // guest — distinct from the seeded demo version so tests don't fight
    // over its stem list.
    private static async Task<Guid> SeedEmptyVersionAsync(WebApplicationFactory<Program> f, Guid userId)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var song = new Song { Id = Guid.NewGuid(), UserId = userId, Name = "Byte cap test" };
        var version = new SongVersion
        {
            Id = Guid.NewGuid(), SongId = song.Id, FilePath = "audio/bytecap/x.wav", VersionNumber = 1,
        };
        db.Songs.Add(song);
        db.SongVersions.Add(version);
        await db.SaveChangesAsync();
        return version.Id;
    }

    private static MultipartFormDataContent OneStem(string name)
    {
        var form = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(DemoSeeder.GenerateToneWav());
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        form.Add(fileContent, "file", name);
        return form;
    }

    private static async Task<string?> Code(HttpResponseMessage resp)
    {
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("error").GetProperty("code").GetString();
    }

    private static async Task<string?> Reason(HttpResponseMessage resp)
    {
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("error").GetProperty("details").GetProperty("reason").GetString();
    }

    private static Task CleanupAsync(WebApplicationFactory<Program> f, params Guid[] userIds) =>
        DemoAuthEndpointsTests.CleanupAsync(f, userIds);

    // ── item 4(a): Content-Length precheck, before the form is read ─────────

    [SkippableFact]
    public async Task Guest_Stems_Stage_Over_The_Byte_Budget_Is_Refused_Without_Reading_The_Body()
    {
        await TestDb.RequireAsync(factory);
        using var f = Build();
        var (client, demo) = await StartGuestAsync(f);
        var guestId = demo.User.Id;
        try
        {
            var versionId = await SeedEmptyVersionAsync(f, guestId);

            // The ACTUAL body is a few hundred bytes and is not even valid
            // multipart — if the handler ever tries to parse it (the
            // pre-fix bug), that is a protocol-level failure, not a clean
            // 403. The declared Content-Length (500 MB) is what the fixed
            // handler must act on, BEFORE any read of the body.
            var content = new ByteArrayContent(new byte[256]);
            content.Headers.ContentType = new MediaTypeHeaderValue("multipart/form-data")
            {
                Parameters = { new NameValueHeaderValue("boundary", "x") },
            };
            content.Headers.ContentLength = 500L * 1024 * 1024;
            var req = new HttpRequestMessage(HttpMethod.Post, $"/api/versions/{versionId}/stems/stage")
            {
                Content = content,
            };
            var resp = await client.SendAsync(req);

            Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
            Assert.Equal("guest_restricted", await Code(resp));
            Assert.Equal("stems_limit", await Reason(resp));
        }
        finally { await CleanupAsync(f, guestId); }
    }

    [SkippableFact]
    public async Task Guest_Reference_Upload_Over_The_Size_Ceiling_Is_Refused_Without_Reading_The_Body()
    {
        await TestDb.RequireAsync(factory);
        using var f = Build();
        var (client, demo) = await StartGuestAsync(f);
        var guestId = demo.User.Id;
        try
        {
            var content = new ByteArrayContent(new byte[256]);
            content.Headers.ContentType = new MediaTypeHeaderValue("multipart/form-data")
            {
                Parameters = { new NameValueHeaderValue("boundary", "x") },
            };
            content.Headers.ContentLength = 500L * 1024 * 1024; // over the 250 MB ceiling
            var req = new HttpRequestMessage(HttpMethod.Post, "/api/references/") { Content = content };
            var resp = await client.SendAsync(req);

            Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
            Assert.Equal("guest_restricted", await Code(resp));
            Assert.Equal("reference_limit", await Reason(resp));
        }
        finally { await CleanupAsync(f, guestId); }
    }

    // ── item 4(b): a Redis lock serialises one guest's stage calls ──────────

    [SkippableFact]
    public async Task Six_Parallel_Guest_Stage_Calls_Never_Exceed_The_File_Cap()
    {
        await TestDb.RequireAsync(factory);
        using var f = Build(); // default DI: the REAL RedisDistributedLock (dev Redis)
        var (client, demo) = await StartGuestAsync(f);
        var guestId = demo.User.Id;
        try
        {
            var versionId = await SeedEmptyVersionAsync(f, guestId);

            // guest_stems_max_files seeds 12. Six parallel calls of 3 files
            // each = 18 attempted — without serialisation every call reads
            // the SAME "0 existing" and all pass their own 0+3<=12 check.
            var tasks = Enumerable.Range(0, 6).Select(async i =>
            {
                var form = new MultipartFormDataContent();
                for (var j = 0; j < 3; j++)
                {
                    var fileContent = new ByteArrayContent(DemoSeeder.GenerateToneWav());
                    fileContent.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
                    form.Add(fileContent, "file", $"race-{i}-{j}.wav");
                }
                return await client.PostAsync($"/api/versions/{versionId}/stems/stage", form);
            }).ToArray();
            await Task.WhenAll(tasks);

            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var raw = await db.SongVersions.AsNoTracking()
                .Where(v => v.Id == versionId).Select(v => v.StemPathsRaw).FirstOrDefaultAsync();
            var entries = Spectr.Bff.Endpoints.VersionEndpoints.ReadRaw(raw);
            Assert.True(entries.Count <= 12, $"expected at most 12 staged stems, got {entries.Count}");
        }
        finally { await CleanupAsync(f, guestId); }
    }

    [SkippableFact]
    public async Task Guest_Stems_Stage_Lock_Unavailable_Fails_Closed_503()
    {
        await TestDb.RequireAsync(factory);
        using var f = Build(distLock: new ThrowingDistributedLock());
        var (client, demo) = await StartGuestAsync(f);
        var guestId = demo.User.Id;
        try
        {
            var versionId = await SeedEmptyVersionAsync(f, guestId);
            var resp = await client.PostAsync($"/api/versions/{versionId}/stems/stage", OneStem("lockfail.wav"));
            Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
            Assert.Equal("demo_capacity", await Code(resp));
        }
        finally { await CleanupAsync(f, guestId); }
    }
}
