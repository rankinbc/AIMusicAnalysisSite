using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.Endpoints;
using Spectr.Bff.Services;
using Spectr.Data;
using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 3.1 — presigned multipart upload endpoints. The S3 store is faked so
// no MinIO/R2 is needed; DB-touching tests are Postgres-gated like the rest
// of the integration suite.
internal sealed class FakeMultipartObjectStore : IMultipartObjectStore
{
    public bool IsConfigured => true;
    public ConcurrentQueue<string> Initiated { get; } = new();
    public ConcurrentQueue<(string Key, string UploadId, int Parts)> Completed { get; } = new();
    public ConcurrentQueue<(string Key, string UploadId)> Aborted { get; } = new();
    public bool ObjectExists { get; set; } = true;

    public Task<string> InitiateMultipartAsync(string key, string contentType, CancellationToken ct = default)
    {
        Initiated.Enqueue(key);
        return Task.FromResult($"upload-{Guid.NewGuid():N}");
    }

    public Task<IReadOnlyList<PresignedPart>> PresignPartUrlsAsync(
        string key, string uploadId, int partCount, CancellationToken ct = default)
    {
        var parts = Enumerable.Range(1, partCount)
            .Select(n => new PresignedPart(n, $"https://fake-s3.test/{key}?partNumber={n}&uploadId={uploadId}"))
            .ToList();
        return Task.FromResult<IReadOnlyList<PresignedPart>>(parts);
    }

    public Task CompleteMultipartAsync(
        string key, string uploadId, IReadOnlyList<CompletedPart> parts, CancellationToken ct = default)
    {
        Completed.Enqueue((key, uploadId, parts.Count));
        return Task.CompletedTask;
    }

    public Task AbortMultipartAsync(string key, string uploadId, CancellationToken ct = default)
    {
        Aborted.Enqueue((key, uploadId));
        return Task.CompletedTask;
    }

    public Task<bool> ObjectExistsAsync(string key, CancellationToken ct = default)
        => Task.FromResult(ObjectExists);
}

public sealed class UploadEndpointsTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private (HttpClient Client, FakeMultipartObjectStore Store, RecordingJobQueue Queue, WebApplicationFactory<Program> Factory)
        NewClient()
    {
        var store = new FakeMultipartObjectStore();
        var queue = new RecordingJobQueue();
        var f = _factory.WithWebHostBuilder(b =>
        {
            b.ConfigureServices(s =>
            {
                s.RemoveAll<IMultipartObjectStore>();
                s.AddSingleton<IMultipartObjectStore>(store);
                s.RemoveAll<IJobQueue>();
                s.AddSingleton<IJobQueue>(queue);
            });
        });
        return (f.CreateClient(), store, queue, f);
    }

    // ── PartMath (pure) ──────────────────────────────────────────────────────

    [Theory]
    [InlineData(1, 1)]                                  // 1 byte → 1 part
    [InlineData(16L * 1024 * 1024, 1)]                  // exactly one part
    [InlineData(16L * 1024 * 1024 + 1, 2)]              // one byte over → 2
    [InlineData(250L * 1024 * 1024, 16)]                // 250 MB → 16 parts
    public void PartMath_UniformSixteenMiB(long fileSize, int expectedParts)
    {
        Assert.Equal(expectedParts, PartMath.PartCount(fileSize, 16L * 1024 * 1024));
    }

    // ── 501 fallback when S3 unconfigured ───────────────────────────────────

    [Fact]
    public async Task Init_S3Unconfigured_Returns501()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        // Default factory: no Storage:S3 config → real S3ObjectStore with
        // IsConfigured=false.
        var client = _factory.CreateClient();
        var (_, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var resp = await client.PostAsJsonAsync("/api/uploads/init",
            new { fileName = "track.wav", fileSize = 1024L });
        Assert.Equal((HttpStatusCode)501, resp.StatusCode);
    }

    // ── init happy path ──────────────────────────────────────────────────────

    [Fact]
    public async Task Init_ReturnsUniformPartsAndUserScopedKey()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (client, store, _, _) = NewClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var fileSize = 40L * 1024 * 1024; // 40 MiB → 3 parts at 16 MiB
        var resp = await client.PostAsJsonAsync("/api/uploads/init",
            new { fileName = "My Track.flac", fileSize });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var body = await resp.Content.ReadFromJsonAsync<UploadEndpoints.InitResponse>();
        Assert.NotNull(body);
        Assert.Equal(3, body!.Parts.Count);
        Assert.Equal(16L * 1024 * 1024, body.PartSizeBytes);
        Assert.StartsWith($"audio/{userId}/{body.JobId}/source", body.Key);
        Assert.EndsWith(".flac", body.Key);
        Assert.Equal(new[] { 1, 2, 3 }, body.Parts.Select(p => p.PartNumber).ToArray());
        Assert.Single(store.Initiated);
    }

    [Fact]
    public async Task Init_OversizedFile_Returns400()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (client, _, _, _) = NewClient();
        var (_, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var resp = await client.PostAsJsonAsync("/api/uploads/init",
            new { fileName = "big.wav", fileSize = 251L * 1024 * 1024 });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    // ── complete ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task Complete_CreatesRowsAndDispatches()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (client, store, queue, f) = NewClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var jobId = Guid.NewGuid();
        var key = $"audio/{userId}/{jobId}/source.wav";
        var resp = await client.PostAsJsonAsync("/api/uploads/complete", new
        {
            jobId,
            key,
            uploadId = "upload-abc",
            parts = new[] { new { partNumber = 1, eTag = "\"etag1\"" } },
        });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var body = await resp.Content.ReadFromJsonAsync<UploadEndpoints.CompleteResponse>();
        Assert.NotNull(body);
        Assert.Equal(jobId, body!.JobId);
        Assert.Single(store.Completed);
        Assert.Single(queue.Calls); // analysis dispatched

        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var version = await db.SongVersions.AsNoTracking().FirstOrDefaultAsync(v => v.Id == body.VersionId);
        Assert.NotNull(version);
        Assert.Equal(key, version!.FilePath);
        Assert.True(version.IsCurrent);
        Assert.Equal(1, await db.AnalysisJobs.CountAsync(j => j.Id == jobId));
    }

    [Fact]
    public async Task Complete_AnalyzeFalse_NoDispatch()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (client, _, queue, _) = NewClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var jobId = Guid.NewGuid();
        var resp = await client.PostAsJsonAsync("/api/uploads/complete", new
        {
            jobId,
            key = $"audio/{userId}/{jobId}/source.wav",
            uploadId = "upload-abc",
            parts = new[] { new { partNumber = 1, eTag = "\"etag1\"" } },
            analyze = false,
        });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<UploadEndpoints.CompleteResponse>();
        Assert.Null(body!.JobId);
        Assert.Empty(queue.Calls);
    }

    [Fact]
    public async Task Complete_ForeignKey_Returns400()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (client, store, queue, _) = NewClient();
        var (_, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        // Key under ANOTHER user's prefix must be rejected before any storage call.
        var resp = await client.PostAsJsonAsync("/api/uploads/complete", new
        {
            jobId = Guid.NewGuid(),
            key = $"audio/{Guid.NewGuid()}/{Guid.NewGuid()}/source.wav",
            uploadId = "upload-abc",
            parts = new[] { new { partNumber = 1, eTag = "\"e\"" } },
        });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        Assert.Empty(store.Completed);
        Assert.Empty(queue.Calls);
    }

    // ── abort ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Abort_OwnKey_Aborts()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (client, store, _, _) = NewClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var resp = await client.PostAsJsonAsync("/api/uploads/abort", new
        {
            key = $"audio/{userId}/{Guid.NewGuid()}/source.wav",
            uploadId = "upload-abc",
        });
        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        Assert.Single(store.Aborted);
    }

    [Fact]
    public async Task Abort_ForeignKey_Returns400()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (client, store, _, _) = NewClient();
        var (_, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var resp = await client.PostAsJsonAsync("/api/uploads/abort", new
        {
            key = $"audio/{Guid.NewGuid()}/{Guid.NewGuid()}/source.wav",
            uploadId = "upload-abc",
        });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        Assert.Empty(store.Aborted);
    }
}
