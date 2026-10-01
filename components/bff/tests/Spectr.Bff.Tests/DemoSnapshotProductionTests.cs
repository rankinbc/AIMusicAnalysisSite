using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.Endpoints;
using Spectr.Bff.Services;
using Spectr.Data;
using Xunit;

namespace Spectr.Bff.Tests;

// Fix wave FW2 — final review I5 + I4 + the manifest-key hole.
//   I5: in production a mix lives ONLY in R2 (presigned upload), so the
//       exporter must read it from the object store when it is not on local
//       disk; and a seeded demo version's LOCAL key must still stream with S3
//       configured.
//   I4: retiring an old export must never delete an asset a (never-expiring)
//       registered account still references.
public sealed class DemoSnapshotProductionTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>, IAsyncLifetime
{
    private readonly List<Guid> _userIds = [];
    private readonly List<Guid> _versionIds = [];
    private readonly List<string> _extraKeys = [];
    private string? _dir;

    public Task InitializeAsync() => Task.CompletedTask;

    // An object store that holds bytes in memory and supports nothing but
    // existence checks and reads — the exporter's only use of it.
    internal sealed class InMemoryObjectStore(bool configured = true) : IMultipartObjectStore
    {
        public ConcurrentDictionary<string, byte[]> Objects { get; } = new();
        public bool IsConfigured => configured;
        public Task<bool> ObjectExistsAsync(string key, CancellationToken ct = default)
            => Task.FromResult(Objects.ContainsKey(key));
        public Task<long?> GetObjectSizeAsync(string key, CancellationToken ct = default)
            => Task.FromResult<long?>(Objects.TryGetValue(key, out var b) ? b.LongLength : null);
        public Task<Stream> OpenReadAsync(string key, CancellationToken ct = default)
            => Objects.TryGetValue(key, out var b)
                ? Task.FromResult<Stream>(new MemoryStream(b))
                : throw new FileNotFoundException(key);
        public string PresignGetUrl(string key, string? downloadName = null, string? contentType = null)
            => $"https://fake-r2.test/{key}?get=1";
        public Task<string> InitiateMultipartAsync(string key, string contentType, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<IReadOnlyList<PresignedPart>> PresignPartUrlsAsync(
            string key, string uploadId, int partCount, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task CompleteMultipartAsync(
            string key, string uploadId, IReadOnlyList<CompletedPart> parts, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task AbortMultipartAsync(string key, string uploadId, CancellationToken ct = default)
            => throw new NotSupportedException();
        public string PresignPutUrl(string key, CancellationToken ct = default) => throw new NotSupportedException();
    }

    private WebApplicationFactory<Program> Build(InMemoryObjectStore store)
    {
        var (f, dir) = DemoSnapshotExportTests.BuildFactory(factory, DemoSnapshotExportTests.Key);
        _dir = dir;
        return f.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll<IMultipartObjectStore>();
            s.AddSingleton<IMultipartObjectStore>(store);
        }));
    }

    private static async Task SetVersionFilePathAsync(WebApplicationFactory<Program> f, Guid versionId, string filePath)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var v = await db.SongVersions.SingleAsync(x => x.Id == versionId);
        v.FilePath = filePath;
        await db.SaveChangesAsync();
    }

    private static Task<HttpResponseMessage> ExportAsync(WebApplicationFactory<Program> f, Guid versionId, string reason)
        => DemoSnapshotExportTests.Admin(f)
            .PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId, reason });

    // ── I5 ────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task Export_Reads_A_Mix_That_Lives_Only_In_Object_Storage()
    {
        await TestDb.RequireAsync(factory);
        var store = new InMemoryObjectStore();
        var f = Build(store);
        var (versionId, _, userId, _) = await DemoSnapshotExportTests.SeedAnalyzedAsync(f, _userIds, _versionIds);
        var r2Key = $"audio/{userId}/{Guid.NewGuid():N}/mix.mp3";
        var bytes = Encoding.ASCII.GetBytes("ID3-fake-production-mix-" + Guid.NewGuid());
        store.Objects[r2Key] = bytes;
        await SetVersionFilePathAsync(f, versionId, r2Key);

        var r = await ExportAsync(f, versionId, "prod-mix");

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var (audioKey, _) = await DemoSnapshotExportTests.ReadAssetKeysAsync(f, _dir + "snapshot.json");
        Assert.NotNull(audioKey);
        Assert.StartsWith(_dir!, audioKey);
        Assert.EndsWith(".mp3", audioKey);
        Assert.Equal(bytes, await DemoSnapshotExportTests.ReadBytesAsync(f, audioKey!));
    }

    [SkippableTheory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Export_Refuses_A_Mix_Found_In_Neither_Store(bool s3Configured)
    {
        await TestDb.RequireAsync(factory);
        var store = new InMemoryObjectStore(s3Configured);
        var f = Build(store);
        var (versionId, _, userId, _) = await DemoSnapshotExportTests.SeedAnalyzedAsync(f, _userIds, _versionIds);
        var key = $"audio/{userId}/{Guid.NewGuid():N}/mix.mp3";
        // Not configured: even an object "in" the store must not be read.
        if (!s3Configured) store.Objects[key] = [1, 2, 3];
        await SetVersionFilePathAsync(f, versionId, key);

        var r = await ExportAsync(f, versionId, "nowhere");

        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
        Assert.Equal("snapshot_not_ready", await DemoSnapshotExportTests.Code(r));
        using var scope = f.Services.CreateScope();
        var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
        Assert.False(await storage.ExistsAsync(_dir + "snapshot.json"));
    }

    // Serving side: a seeded demo version points at a LOCAL key; with S3
    // configured it must still stream from disk, never 404/redirect.
    [SkippableFact]
    public async Task A_Local_Demo_Key_Streams_With_Object_Storage_Configured()
    {
        await TestDb.RequireAsync(factory);
        var f = Build(new InMemoryObjectStore());
        var client = f.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var (userId, token) = await TestAuth.RegisterWithDemoAsync(f, client);
        _userIds.Add(userId);
        Guid versionId;
        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            versionId = (await db.Analyses.AsNoTracking().SingleAsync(a => a.UserId == userId)).VersionId!.Value;
        }
        _versionIds.Add(versionId);

        using var req = new HttpRequestMessage(HttpMethod.Get, $"/api/versions/{versionId}/audio");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var r = await client.SendAsync(req);

        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.StartsWith("audio/", r.Content.Headers.ContentType?.MediaType);
    }

    // ── I4 ────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task Retiring_An_Old_Export_Keeps_What_A_Registered_Account_Still_Uses()
    {
        await TestDb.RequireAsync(factory);
        var f = Build(new InMemoryObjectStore(configured: false));
        var snapshotKey = _dir + "snapshot.json";
        var manifestKey = _dir + "retired.json";

        // Export A.
        var (versionA, _, _, _) = await DemoSnapshotExportTests.SeedAnalyzedAsync(f, _userIds, _versionIds);
        (await ExportAsync(f, versionA, "export-a")).EnsureSuccessStatusCode();
        var (audioKeyA, _) = await DemoSnapshotExportTests.ReadAssetKeysAsync(f, snapshotKey);
        _extraKeys.Add(audioKeyA!);

        // A permanent account registers while A is live — seeded from A.
        var client = f.CreateClient();
        var (accountId, token) = await TestAuth.RegisterWithDemoAsync(f, client);
        _userIds.Add(accountId);
        Guid accountVersion;
        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var a = await db.Analyses.AsNoTracking().SingleAsync(x => x.UserId == accountId);
            accountVersion = a.VersionId!.Value;
            Assert.Equal(audioKeyA, (await db.SongVersions.AsNoTracking().SingleAsync(v => v.Id == accountVersion)).FilePath);
        }
        _versionIds.Add(accountVersion);

        // Export B (from the account's own version) stages A for retirement.
        (await ExportAsync(f, accountVersion, "export-b")).EnsureSuccessStatusCode();

        // Age the manifest past the guest TTL + 1 h, and add a key nobody uses.
        var orphanKey = _dir + "orphan-" + Guid.NewGuid().ToString("N") + "/source.wav";
        _extraKeys.Add(orphanKey);
        using (var scope = f.Services.CreateScope())
        {
            var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
            await storage.WriteAsync(orphanKey, new MemoryStream([1, 2, 3]), "audio/wav");
            var aged = "[{\"keys\":[\"" + audioKeyA + "\",\"" + orphanKey + "\"],\"retiredAt\":\""
                + DateTimeOffset.UtcNow.AddHours(-(24 + 2)).ToString("O") + "\"}]";
            await storage.WriteAsync(manifestKey, new MemoryStream(Encoding.UTF8.GetBytes(aged)), "application/json");
        }

        // Export C runs the sweep.
        var (versionC, _, _, _) = await DemoSnapshotExportTests.SeedAnalyzedAsync(f, _userIds, _versionIds);
        (await ExportAsync(f, versionC, "export-c")).EnsureSuccessStatusCode();

        using (var scope = f.Services.CreateScope())
        {
            var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
            Assert.True(await storage.ExistsAsync(audioKeyA!), "an asset a registered account still references must survive");
            Assert.False(await storage.ExistsAsync(orphanKey), "an asset referenced by nobody is still retired");

            // The kept key stays staged so the next export re-checks it.
            await using var stream = await storage.OpenReadAsync(manifestKey);
            var manifest = await new StreamReader(stream).ReadToEndAsync();
            Assert.Contains(audioKeyA!, manifest);
            Assert.DoesNotContain(orphanKey, manifest);
        }

        using var req = new HttpRequestMessage(HttpMethod.Get, $"/api/versions/{accountVersion}/audio");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(req)).StatusCode);
    }

    [Fact]
    public void The_Retirement_Manifest_Is_Never_Retireable()
    {
        const string dir = "audio/demo/snapshot/";
        Assert.False(AdminEndpoints.IsRetireableAssetKey(
            dir + "retired.json", dir, dir + "snapshot.json", dir + "new-export/"));
        Assert.True(AdminEndpoints.IsRetireableAssetKey(
            dir + "old-export/source.wav", dir, dir + "snapshot.json", dir + "new-export/"));
    }

    public async Task DisposeAsync()
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await TestAuth.AllowPurgeAsync(db);
        var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
        if (_dir is not null)
        {
            var (audioKey, imageKeys) = await DemoSnapshotExportTests.ReadAssetKeysAsync(factory, _dir + "snapshot.json");
            if (audioKey is not null) await storage.DeleteAsync(audioKey);
            foreach (var key in imageKeys) await storage.DeleteAsync(key);
            await storage.DeleteAsync(_dir + "snapshot.json");
            await storage.DeleteAsync(_dir + "retired.json");
        }
        foreach (var key in _extraKeys) await storage.DeleteAsync(key);
        if (_versionIds.Count > 0)
        {
            var targets = _versionIds.Select(v => v.ToString()).ToList();
            await db.AuditLogs.Where(a => targets.Contains(a.Target)).ExecuteDeleteAsync();
        }
        foreach (var userId in _userIds)
            await DemoSnapshotSeedTests.CleanupAsync(factory, userId);
    }
}
