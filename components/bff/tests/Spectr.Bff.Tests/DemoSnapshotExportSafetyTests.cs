using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.Services;
using Spectr.Data;
using Xunit;

namespace Spectr.Bff.Tests;

// Fix-round-2 (post-review of fix-round-1): two NEW holes the atomic-export
// rewrite introduced. Reuses DemoSnapshotExportTests' helpers (Build/
// BuildFactory/Admin/Code/SeedAnalyzedAsync/ReadAssetKeysAsync/ReadBytesAsync
// are `internal static` there) instead of duplicating them —
// DemoSnapshotExportTests.cs is already 539 lines.
public sealed class DemoSnapshotExportSafetyTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>, IAsyncLifetime
{
    private readonly List<Guid> _userIds = [];
    private readonly List<Guid> _versionIds = [];
    private string? _dir;

    public Task InitializeAsync() => Task.CompletedTask;

    // (b) — wraps the real storage and fails the FIRST call to GetFileSizeAsync
    // — the handler's very next call immediately after the go-live
    // snapshot.json write succeeds — exactly once. A naive "throw inside
    // WriteAsync(snapshotKey, …)" would unwind BEFORE the handler's own
    // `wentLive = true` line ever runs, which tests the wrong thing (the
    // go-live write's own failure, already handled pre-fix-round-2). This
    // targets a failure strictly AFTER go-live succeeded. Throwing only once
    // (not on every call) matters: the test's own later registration reads
    // the freshly-exported snapshot through DemoSnapshotStore, which also
    // calls GetFileSizeAsync as part of its own size-cap check — that later
    // call must succeed normally.
    private sealed class ThrowsOnceOnGetFileSizeStorage(IFileStorage inner, string onlyForKeyPrefix) : IFileStorage
    {
        private bool _thrown;

        public Task<Stream> OpenReadAsync(string key, CancellationToken ct = default) => inner.OpenReadAsync(key, ct);
        public Task<string> WriteAsync(string key, Stream content, string contentType, CancellationToken ct = default)
            => inner.WriteAsync(key, content, contentType, ct);
        public Task<bool> DeleteAsync(string key, CancellationToken ct = default) => inner.DeleteAsync(key, ct);
        public Task<Uri> GetPresignedReadUrlAsync(string key, TimeSpan expiry) => inner.GetPresignedReadUrlAsync(key, expiry);
        public Task<bool> ExistsAsync(string key, CancellationToken ct = default) => inner.ExistsAsync(key, ct);

        // Scoped to keys under THIS test's own export prefix, not just "the
        // first call ever" — the shared canonical demo audio's own
        // EnsureDemoAudioAsync size-check runs during SeedAnalyzedAsync's
        // registration, before the export even starts, and must not be hit.
        public Task<long?> GetFileSizeAsync(string key, CancellationToken ct = default)
        {
            if (!_thrown && key.StartsWith(onlyForKeyPrefix, StringComparison.Ordinal))
            {
                _thrown = true;
                throw new IOException("simulated failure immediately after the snapshot.json go-live write");
            }
            return inner.GetFileSizeAsync(key, ct);
        }
    }

    // Task G7a — retirement of the PREVIOUS export's assets is now deferred:
    // a guest mid-session against export A must keep working for the rest of
    // their guest lifetime, so a second export must never delete A's assets
    // immediately. Instead it stages them into a manifest
    // ("<dir>retired.json", next to snapshot.json — same directory as the
    // configured Demo:SnapshotKey, so every test below that uses
    // BuildFactory's per-test random dir is automatically isolated from the
    // real installed manifest) and only actually deletes an entry once it is
    // older than guest_ttl_hours + 1h. The IsRetireableAssetKey guard still
    // applies at the moment a key is ACTUALLY deleted (item (d) below).

    private static async Task<(WebApplicationFactory<Program> F, string Dir, string SnapshotKey, string AudioKeyA)>
        SeedTwoLiveExportsAsync(WebApplicationFactory<Program> factory, List<Guid> userIds, List<Guid> versionIds)
    {
        var (f, dir) = DemoSnapshotExportTests.BuildFactory(factory, DemoSnapshotExportTests.Key);
        var snapshotKey = dir + "snapshot.json";

        var (versionIdA, _, _, _) = await DemoSnapshotExportTests.SeedAnalyzedAsync(f, userIds, versionIds);
        var rA = await DemoSnapshotExportTests.Admin(f)
            .PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId = versionIdA, reason = "export-a" });
        rA.EnsureSuccessStatusCode();
        var (audioKeyA, _) = await DemoSnapshotExportTests.ReadAssetKeysAsync(f, snapshotKey);
        Assert.NotNull(audioKeyA);

        var (versionIdB, _, _, _) = await DemoSnapshotExportTests.SeedAnalyzedAsync(f, userIds, versionIds);
        var rB = await DemoSnapshotExportTests.Admin(f)
            .PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId = versionIdB, reason = "export-b" });
        rB.EnsureSuccessStatusCode();

        return (f, dir, snapshotKey, audioKeyA!);
    }

    private static async Task SetVersionFilePathAsync(WebApplicationFactory<Program> f, Guid versionId, string filePath)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var v = await db.SongVersions.SingleAsync(x => x.Id == versionId);
        v.FilePath = filePath;
        await db.SaveChangesAsync();
    }

    // ── (a) — a version whose source audio object does not exist ──────────
    [SkippableFact]
    public async Task Export_Refuses_When_The_Source_Audio_Is_Missing()
    {
        await TestDb.RequireAsync(factory);
        WebApplicationFactory<Program> f;
        (f, _dir) = DemoSnapshotExportTests.BuildFactory(factory, DemoSnapshotExportTests.Key);
        var (versionId, _, _, _) = await DemoSnapshotExportTests.SeedAnalyzedAsync(f, _userIds, _versionIds);
        var missingKey = $"audio/versions/{Guid.NewGuid():N}/gone.wav";
        await SetVersionFilePathAsync(f, versionId, missingKey);

        var r = await DemoSnapshotExportTests.Admin(f)
            .PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId, reason = "missing-audio" });

        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
        Assert.Equal("snapshot_not_ready", await DemoSnapshotExportTests.Code(r));

        using var scope = f.Services.CreateScope();
        var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
        Assert.False(await storage.ExistsAsync(_dir + "snapshot.json"),
            "nothing should be written when the source audio is missing");
    }

    // ── (b) — a second export defers retirement instead of deleting immediately ──
    [SkippableFact]
    public async Task Retirement_Is_Deferred_Not_Immediate()
    {
        await TestDb.RequireAsync(factory);
        var (f, dir, _, audioKeyA) = await SeedTwoLiveExportsAsync(factory, _userIds, _versionIds);
        _dir = dir;

        using var scope = f.Services.CreateScope();
        var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
        try
        {
            Assert.True(await storage.ExistsAsync(audioKeyA),
                "export B must not delete export A's audio while a guest could still be pointing at it");

            var manifestKey = dir + "retired.json";
            Assert.True(await storage.ExistsAsync(manifestKey), "export B must record A's assets for later retirement");
            await using var stream = await storage.OpenReadAsync(manifestKey);
            using var doc = await JsonDocument.ParseAsync(stream);
            var root = doc.RootElement;
            Assert.Equal(JsonValueKind.Array, root.ValueKind);
            Assert.True(root.GetArrayLength() >= 1);
            var entry = root[0];
            var keys = entry.GetProperty("keys").EnumerateArray().Select(e => e.GetString()).ToList();
            Assert.Contains(audioKeyA, keys);
            var retiredAt = entry.GetProperty("retiredAt").GetDateTimeOffset();
            Assert.True(
                retiredAt > DateTimeOffset.UtcNow.AddMinutes(-5) && retiredAt <= DateTimeOffset.UtcNow.AddMinutes(1),
                "retiredAt should be close to the time export B went live");
        }
        finally
        {
            // Not caught by DisposeAsync's snapshot-key reader — B, not A, is
            // the current live snapshot's audio by the time this test ends.
            await storage.DeleteAsync(audioKeyA);
        }
    }

    // ── (c) — an entry past guest_ttl_hours + 1h is actually swept ────────
    [SkippableFact]
    public async Task Retirement_Sweeps_Expired_Entries_After_The_Guest_Ttl_Window()
    {
        await TestDb.RequireAsync(factory);
        var (f, dir, _, audioKeyA) = await SeedTwoLiveExportsAsync(factory, _userIds, _versionIds);
        _dir = dir;
        var manifestKey = dir + "retired.json";

        using (var scope = f.Services.CreateScope())
        {
            var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
            // Age the one recorded entry past the default 24h guest TTL + 1h grace window.
            var aged = "[{\"keys\":[\"" + audioKeyA + "\"],\"retiredAt\":\""
                + DateTimeOffset.UtcNow.AddHours(-(24 + 2)).ToString("O") + "\"}]";
            await storage.WriteAsync(manifestKey, new MemoryStream(Encoding.UTF8.GetBytes(aged)), "application/json");
        }

        // A third export runs the sweep again.
        var (versionIdC, _, _, _) = await DemoSnapshotExportTests.SeedAnalyzedAsync(f, _userIds, _versionIds);
        var rC = await DemoSnapshotExportTests.Admin(f)
            .PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId = versionIdC, reason = "export-c" });
        rC.EnsureSuccessStatusCode();

        using var scope2 = f.Services.CreateScope();
        var storage2 = scope2.ServiceProvider.GetRequiredService<IFileStorage>();
        Assert.False(await storage2.ExistsAsync(audioKeyA),
            "an entry past the guest TTL + 1h window must actually be deleted");

        await using var stream = await storage2.OpenReadAsync(manifestKey);
        using var doc = await JsonDocument.ParseAsync(stream);
        var keysStillListed = doc.RootElement.EnumerateArray()
            .SelectMany(e => e.GetProperty("keys").EnumerateArray().Select(k => k.GetString()))
            .ToList();
        Assert.DoesNotContain(audioKeyA, keysStillListed);
    }

    // ── (d) — the sweep must never delete a key it does not own ───────────
    [SkippableFact]
    public async Task Retirement_Sweep_Never_Deletes_A_Key_Outside_Its_Own_Directory()
    {
        await TestDb.RequireAsync(factory);
        WebApplicationFactory<Program> f;
        (f, _dir) = DemoSnapshotExportTests.BuildFactory(factory, DemoSnapshotExportTests.Key);
        var (versionId, _, _, _) = await DemoSnapshotExportTests.SeedAnalyzedAsync(f, _userIds, _versionIds);
        var manifestKey = _dir + "retired.json";

        using var scope = f.Services.CreateScope();
        var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();

        var foreignKey = "audio/users/x.wav";        // a real user's audio — outside audio/demo/ entirely
        var sharedKey = DemoSeeder.DemoAudioKey;      // "audio/demo/source.wav" — the shared sine-tone every account uses
        var oldExportId = Guid.NewGuid().ToString("N");
        var legitimateOldKey = _dir + oldExportId + "/source.wav";

        await storage.WriteAsync(foreignKey, new MemoryStream("USERAUDIO"u8.ToArray()), "audio/wav");
        await storage.WriteAsync(legitimateOldKey, new MemoryStream("OLDEXPORT"u8.ToArray()), "audio/wav");
        // SeedAnalyzedAsync's fallback seed already wrote the shared canonical
        // audio as a side effect — confirm the precondition rather than
        // writing it ourselves (never author-write the shared canonical key).
        Assert.True(await storage.ExistsAsync(sharedKey));

        // An already-expired manifest entry naming a foreign key and the
        // shared canonical key alongside one legitimate old-export key — as
        // if a prior export's asset discovery had been tampered with.
        var expiredEntry = "[{\"keys\":[\"" + foreignKey + "\",\"" + sharedKey + "\",\"" + legitimateOldKey + "\"],"
            + "\"retiredAt\":\"" + DateTimeOffset.UtcNow.AddHours(-(24 + 2)).ToString("O") + "\"}]";
        await storage.WriteAsync(manifestKey, new MemoryStream(Encoding.UTF8.GetBytes(expiredEntry)), "application/json");

        try
        {
            var r = await DemoSnapshotExportTests.Admin(f)
                .PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId, reason = "retire-guard" });
            r.EnsureSuccessStatusCode();

            Assert.True(await storage.ExistsAsync(foreignKey),
                "a foreign key outside audio/demo/ must never be retired");
            Assert.True(await storage.ExistsAsync(sharedKey),
                "the shared sine-tone canonical audio must never be retired");
            Assert.False(await storage.ExistsAsync(legitimateOldKey),
                "the legitimate expired old-export asset SHOULD be retired");
        }
        finally
        {
            await storage.DeleteAsync(foreignKey);
            await storage.DeleteAsync(legitimateOldKey); // no-op if already retired
            // Self-heal: unconditionally restore the shared canonical demo
            // audio to its deterministic content. Safe regardless of what
            // this test (or the bug it proves) did to it — byte-identical to
            // what DemoSeeder.EnsureDemoAudioAsync itself (re)writes.
            await storage.WriteAsync(sharedKey, new MemoryStream(DemoSeeder.GenerateToneWav()), "audio/wav");
        }
    }

    // ── (e) — a corrupt manifest never blocks the export ───────────────────
    [SkippableFact]
    public async Task Retirement_Manifest_Corruption_Never_Blocks_The_Export()
    {
        await TestDb.RequireAsync(factory);
        WebApplicationFactory<Program> f;
        (f, _dir) = DemoSnapshotExportTests.BuildFactory(factory, DemoSnapshotExportTests.Key);
        var manifestKey = _dir + "retired.json";

        using (var scope = f.Services.CreateScope())
        {
            var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
            await storage.WriteAsync(manifestKey, new MemoryStream("{not valid json"u8.ToArray()), "application/json");
        }

        var (versionId, _, _, _) = await DemoSnapshotExportTests.SeedAnalyzedAsync(f, _userIds, _versionIds);
        var r = await DemoSnapshotExportTests.Admin(f)
            .PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId, reason = "corrupt-manifest" });
        r.EnsureSuccessStatusCode();

        using var scope2 = f.Services.CreateScope();
        var storage2 = scope2.ServiceProvider.GetRequiredService<IFileStorage>();
        // The corrupt manifest is replaced with a fresh, valid, parseable one.
        await using var stream = await storage2.OpenReadAsync(manifestKey);
        using var doc = await JsonDocument.ParseAsync(stream);
        Assert.Equal(JsonValueKind.Array, doc.RootElement.ValueKind);
    }

    // ── fix-round-2 (b) — a post-go-live failure must never delete the live demo ──
    [SkippableFact]
    public async Task A_Failure_After_GoLive_Never_Deletes_The_New_Live_Demo()
    {
        await TestDb.RequireAsync(factory);
        _dir = $"audio/demo/test-snapshots/{Guid.NewGuid():N}/";
        var snapshotKey = _dir + "snapshot.json";
        var f = factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Admin:ApiKey", DemoSnapshotExportTests.Key);
            b.UseSetting("Demo:SnapshotKey", snapshotKey);
            b.ConfigureTestServices(s =>
            {
                s.RemoveAll(typeof(IFileStorage));
                // Wrap the real LocalDiskFileStorage: the snapshot.json write
                // itself genuinely succeeds; the handler's very next call
                // (GetFileSizeAsync, for the response's AudioBytes) throws
                // once — simulating a crash (or a failing audit
                // SaveChangesAsync) strictly AFTER go-live.
                s.AddSingleton<IFileStorage>(sp => new ThrowsOnceOnGetFileSizeStorage(
                    new LocalDiskFileStorage(sp.GetRequiredService<IConfiguration>()), _dir!));
            });
        });

        var (versionId, _, _, _) = await DemoSnapshotExportTests.SeedAnalyzedAsync(f, _userIds, _versionIds);

        var r = await DemoSnapshotExportTests.Admin(f)
            .PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId, reason = "golive-crash" });
        // The handler's catch never deletes writtenKeys once wentLive is set
        // and rethrows — the shared exception-handler envelope turns that
        // into a 500 internal_error (Program.cs UseExceptionHandler).
        Assert.Equal(HttpStatusCode.InternalServerError, r.StatusCode);
        Assert.Equal("internal_error", await DemoSnapshotExportTests.Code(r));

        using var scope = f.Services.CreateScope();
        var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
        Assert.True(await storage.ExistsAsync(snapshotKey), "the new snapshot.json must survive a post-go-live failure");
        var (audioKey, _) = await DemoSnapshotExportTests.ReadAssetKeysAsync(f, snapshotKey);
        Assert.NotNull(audioKey);
        Assert.True(await storage.ExistsAsync(audioKey!), "the new export's audio object must survive a post-go-live failure");

        // And it still seeds a NEW user correctly — verified against a
        // BRAND-NEW host (its own IMemoryCache), not `f`: the very first
        // registration above (SeedAnalyzedAsync, before the export existed)
        // already primed `f`'s 60s DemoSnapshotStore cache with a negative
        // ("no snapshot yet") result, and this test's simulated failure fires
        // before the handler's own snapshotStore.Invalidate() call runs — so
        // `f` itself would still serve that stale negative result for up to
        // 60s, which is a cache-TTL artifact of THIS test's request order,
        // not evidence about whether the export durably went live. A fresh
        // host reading the same on-disk storage proves the latter.
        var freshFactory = factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Admin:ApiKey", DemoSnapshotExportTests.Key);
            b.UseSetting("Demo:SnapshotKey", snapshotKey);
        });
        var (newUserId, _) = await TestAuth.RegisterAsync(freshFactory.CreateClient());
        _userIds.Add(newUserId);
        using var freshScope = freshFactory.Services.CreateScope();
        var seeder = freshScope.ServiceProvider.GetRequiredService<DemoSeeder>();
        var found = await seeder.FindAsync(newUserId);
        Assert.NotNull(found);
        Assert.True(found!.FromSnapshot);
    }

    public async Task DisposeAsync()
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await TestAuth.AllowPurgeAsync(db);

        if (_dir is not null)
        {
            var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
            var (audioKey, imageKeys) = await DemoSnapshotExportTests.ReadAssetKeysAsync(factory, _dir + "snapshot.json");
            if (audioKey is not null) await storage.DeleteAsync(audioKey);
            foreach (var key in imageKeys) await storage.DeleteAsync(key);
            await storage.DeleteAsync(_dir + "snapshot.json");
            // Task G7a — the deferred-retirement manifest lives next to
            // snapshot.json; some tests' own audioKeyA (from an earlier
            // export round in the same dir) is not the CURRENT live
            // snapshot's audio key, so it is not caught by ReadAssetKeysAsync
            // above — those tests clean it up themselves. This only clears
            // the manifest file itself.
            await storage.DeleteAsync(_dir + "retired.json");
        }
        if (_versionIds.Count > 0)
        {
            var targets = _versionIds.Select(v => v.ToString()).ToList();
            await db.AuditLogs.Where(a => targets.Contains(a.Target)).ExecuteDeleteAsync();
        }
        foreach (var userId in _userIds)
            await DemoSnapshotSeedTests.CleanupAsync(factory, userId);
    }
}
