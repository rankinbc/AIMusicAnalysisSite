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

    public long ObjectSize { get; set; } = 1024;

    public Task<long?> GetObjectSizeAsync(string key, CancellationToken ct = default)
        => Task.FromResult<long?>(ObjectExists ? ObjectSize : null);

    public ConcurrentQueue<string> PresignedPuts { get; } = new();

    public string PresignPutUrl(string key, CancellationToken ct = default)
    {
        PresignedPuts.Enqueue(key);
        return $"https://fake-s3.test/{key}?put=1";
    }

    public ConcurrentQueue<(string Key, string? DownloadName)> PresignedGets { get; } = new();

    public string PresignGetUrl(string key, string? downloadName = null, CancellationToken ct = default)
    {
        PresignedGets.Enqueue((key, downloadName));
        return $"https://fake-s3.test/{key}?get=1&X-Amz-Expires=900";
    }
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

    // ── Story 3.2 — presigned attachments (init + registration) ─────────────

    // Creates a presigned-layout version (audio/{userId}/{jobId}/source.wav)
    // via /uploads/complete (analyze=false) so jobId derivation has a target.
    private static async Task<(Guid VersionId, Guid JobId, Guid UserId)> SeedPresignedVersion(
        HttpClient client, Guid userId)
    {
        var jobId = Guid.NewGuid();
        var resp = await client.PostAsJsonAsync("/api/uploads/complete", new
        {
            jobId,
            key = $"audio/{userId}/{jobId}/source.wav",
            uploadId = "upload-abc",
            parts = new[] { new { partNumber = 1, eTag = "\"e\"" } },
            analyze = false,
        });
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<UploadEndpoints.CompleteResponse>();
        return (body!.VersionId, jobId, userId);
    }

    [Fact]
    public async Task AttachmentInit_Mints_JobScoped_Keys_Per_Kind()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (client, store, _, _) = NewClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var (versionId, jobId, _) = await SeedPresignedVersion(client, userId);

        // stem → stems/{jobId}/{stemId}.wav (AR20)
        var stem = await client.PostAsJsonAsync("/api/uploads/attachments/init",
            new { kind = "stem", versionId, fileName = "Kick.wav", fileSize = 1024L });
        Assert.Equal(HttpStatusCode.OK, stem.StatusCode);
        var stemBody = await stem.Content.ReadFromJsonAsync<UploadEndpoints.AttachmentInitResponse>();
        Assert.StartsWith($"stems/{jobId}/", stemBody!.Key);
        Assert.EndsWith(".wav", stemBody.Key);
        Assert.NotNull(stemBody.StemId);

        // als → als/{jobId}/project.als
        var als = await client.PostAsJsonAsync("/api/uploads/attachments/init",
            new { kind = "als", versionId, fileName = "proj.als", fileSize = 1024L });
        var alsBody = await als.Content.ReadFromJsonAsync<UploadEndpoints.AttachmentInitResponse>();
        Assert.Equal($"als/{jobId}/project.als", alsBody!.Key);

        // reference → reference/{refId}/source.mp3 (no version needed)
        var reference = await client.PostAsJsonAsync("/api/uploads/attachments/init",
            new { kind = "reference", fileName = "ref.mp3", fileSize = 1024L });
        var refBody = await reference.Content.ReadFromJsonAsync<UploadEndpoints.AttachmentInitResponse>();
        Assert.NotNull(refBody!.ReferenceId);
        Assert.Equal($"reference/{refBody.ReferenceId}/source.mp3", refBody.Key);

        Assert.Equal(3, store.PresignedPuts.Count);
    }

    [Fact]
    public async Task AttachmentInit_Enforces_Ownership_Kinds_And_Limits()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (client, _, _, _) = NewClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var (versionId, _, _) = await SeedPresignedVersion(client, userId);

        // Someone else's version → 404 (never leaks existence).
        var (attacker, attackerToken) = await TestAuth.RegisterAsync(_factory.CreateClient());
        var attackerClient = NewClient().Client;
        attackerClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", attackerToken);
        Assert.Equal(HttpStatusCode.NotFound, (await attackerClient.PostAsJsonAsync(
            "/api/uploads/attachments/init",
            new { kind = "stem", versionId, fileName = "k.wav", fileSize = 10L })).StatusCode);
        _ = attacker;

        // Wrong extension / oversize / bad kind → 400.
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(
            "/api/uploads/attachments/init",
            new { kind = "stem", versionId, fileName = "k.mp3", fileSize = 10L })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(
            "/api/uploads/attachments/init",
            new { kind = "als", versionId, fileName = "p.als", fileSize = 51L * 1024 * 1024 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(
            "/api/uploads/attachments/init",
            new { kind = "nope", versionId, fileName = "x.wav", fileSize = 10L })).StatusCode);
    }

    [Fact]
    public async Task StageKeys_Registers_Existing_Objects_And_Rejects_Foreign_Prefix()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (client, store, _, f) = NewClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var (versionId, jobId, _) = await SeedPresignedVersion(client, userId);

        // Foreign prefix (another jobId) → 400.
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(
            $"/api/versions/{versionId}/stems/stage-keys",
            new { stems = new[] { new { stemId = "s1", key = $"stems/{Guid.NewGuid()}/s1.wav", fileName = "K.wav" } } })).StatusCode);

        // Traversal-shaped key: valid prefix + extension but `..` segments —
        // must be rejected before any storage/DB write (review High #2).
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(
            $"/api/versions/{versionId}/stems/stage-keys",
            new { stems = new[] { new { stemId = "s1", key = $"stems/{jobId}/../../audio/{Guid.NewGuid()}/{Guid.NewGuid()}/source.wav", fileName = "K.wav" } } })).StatusCode);

        // Missing object → 502 upload_not_found.
        store.ObjectExists = false;
        Assert.Equal((HttpStatusCode)502, (await client.PostAsJsonAsync(
            $"/api/versions/{versionId}/stems/stage-keys",
            new { stems = new[] { new { stemId = "s1", key = $"stems/{jobId}/s1.wav", fileName = "K.wav" } } })).StatusCode);

        // Oversize ACTUAL object (client lied at init) → 400 (review High #3).
        store.ObjectExists = true;
        store.ObjectSize = 251L * 1024 * 1024;
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(
            $"/api/versions/{versionId}/stems/stage-keys",
            new { stems = new[] { new { stemId = "s1", key = $"stems/{jobId}/s1.wav", fileName = "K.wav" } } })).StatusCode);
        store.ObjectSize = 1024;

        // Happy path appends staged entries with the R2 keys.
        store.ObjectExists = true;
        var ok = await client.PostAsJsonAsync(
            $"/api/versions/{versionId}/stems/stage-keys",
            new { stems = new[] {
                new { stemId = "s1", key = $"stems/{jobId}/s1.wav", fileName = "Kick.wav" },
                new { stemId = "s2", key = $"stems/{jobId}/s2.flac", fileName = "Bass.flac" },
            } });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);

        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var raw = (await db.SongVersions.AsNoTracking().SingleAsync(v => v.Id == versionId)).StemPathsRaw;
        Assert.Contains($"stems/{jobId}/s1.wav", raw);
        Assert.Contains("Bass.flac", raw);
    }

    [Fact]
    public async Task AlsKey_Registers_Without_Dispatch_When_Analyze_False()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (client, _, queue, f) = NewClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var (versionId, jobId, _) = await SeedPresignedVersion(client, userId);

        var resp = await client.PostAsJsonAsync($"/api/versions/{versionId}/als-key", new
        {
            key = $"als/{jobId}/project.als",
            analyze = false,
            projectJson = """{"tracks":[]}""",
        });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        Assert.Empty(queue.Calls);

        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var v = await db.SongVersions.AsNoTracking().SingleAsync(x => x.Id == versionId);
        Assert.Equal($"als/{jobId}/project.als", v.AlsFilePath);
        Assert.NotNull(v.AlsProjectJson);
    }

    [Fact]
    public async Task ReferenceCompleteKey_Creates_Row_With_R2_Key()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (client, _, _, f) = NewClient();
        var (_, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var init = await client.PostAsJsonAsync("/api/uploads/attachments/init",
            new { kind = "reference", fileName = "Anthem.wav", fileSize = 2048L });
        var initBody = await init.Content.ReadFromJsonAsync<UploadEndpoints.AttachmentInitResponse>();

        var resp = await client.PostAsJsonAsync("/api/references/complete-key", new
        {
            referenceId = initBody!.ReferenceId,
            key = initBody.Key,
            fileName = "Anthem.wav",
            title = "Anthem",
        });
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);

        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var row = await db.ReferenceTracks.AsNoTracking().SingleAsync(r => r.Id == initBody.ReferenceId);
        Assert.Equal(initBody.Key, row.FilePath);
        Assert.Equal("Anthem", row.Title);

        // Key/refId mismatch → 400; duplicate registration → 409.
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(
            "/api/references/complete-key",
            new { referenceId = Guid.NewGuid(), key = initBody.Key, fileName = "x.wav" })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync(
            "/api/references/complete-key",
            new { referenceId = initBody.ReferenceId, key = initBody.Key, fileName = "x.wav" })).StatusCode);
    }
}
