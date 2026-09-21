using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.DTOs;
using Spectr.Bff.Endpoints;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using Xunit;

namespace Spectr.Bff.Tests;

// Task D4 — admin demo-snapshot exporter: POST /api/admin/demo/snapshot
// exports ONE real analyzed version (final_json, routing plan, verdicts incl.
// fix ops, the owner's coach conversation, rack presets, images, audio) to
// storage under audio/demo/snapshot/, in place, so a fresh sign-up can seed
// from it (D3/DemoSeeder). Spec §6 + §6.1 bind the shape and the seed-time
// safety rules this exporter must respect.
//
// Fix-round-1: the reviewer confirmed admin auth, leak-scan-on-final-bytes,
// streaming copy, write ordering and exclusions were solid, then found the
// exporter never validated ITS OWN destination and wasn't atomic against the
// live demo. These tests cover the fix: destination validation before any
// write (1), atomic per-export directories with best-effort retirement of
// the previous export's assets (2), the shared ValidateReason convention
// (3), the documented empty-string disable value (4), a content-level round
// trip (5), an injectable size cap (6), and the free-text disclosure (7).
public sealed class DemoSnapshotExportTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>, IAsyncLifetime
{
    private const string Key = "test-admin-key-0123456789-0123456789-d4";
    private readonly List<Guid> _userIds = [];
    private readonly List<Guid> _versionIds = [];
    private readonly List<string> _assetKeys = [];
    private string? _dir;

    public Task InitializeAsync() => Task.CompletedTask;

    private WebApplicationFactory<Program> Build(long? maxBytes = null)
    {
        _dir = $"audio/demo/test-snapshots/{Guid.NewGuid():N}/";
        return factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Admin:ApiKey", Key);
            b.UseSetting("Demo:SnapshotKey", _dir + "snapshot.json");
            if (maxBytes is { } m) b.UseSetting("Demo:SnapshotExportMaxBytes", m.ToString());
        });
    }

    private static HttpClient Admin(WebApplicationFactory<Program> f)
    {
        var c = f.CreateClient();
        c.DefaultRequestHeaders.Add("X-Admin-Key", Key);
        return c;
    }

    private static async Task<string?> Code(HttpResponseMessage r)
    {
        using var doc = JsonDocument.Parse(await r.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("error").GetProperty("code").GetString();
    }

    private static async Task SetAsync(WebApplicationFactory<Program> f, Guid analysisId, Action<Analysis> mutate)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var a = await db.Analyses.SingleAsync(x => x.Id == analysisId);
        mutate(a);
        await db.SaveChangesAsync();
    }

    // Registers a fresh user (triggering DemoSeeder.SeedAsync — since
    // Demo:SnapshotKey points at a not-yet-written key in this test's own
    // directory, that seed falls back to the sine-tone report, which after
    // D3 already carries a non-null routing plan) and returns the seeded
    // version/analysis to export FROM.
    private async Task<(Guid VersionId, Guid AnalysisId, Guid UserId, string Email)> SeedAnalyzedAsync(WebApplicationFactory<Program> f)
    {
        var (userId, _) = await TestAuth.RegisterAsync(f.CreateClient());
        _userIds.Add(userId);
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = await db.Users.AsNoTracking().SingleAsync(u => u.Id == userId);
        var analysis = await db.Analyses.AsNoTracking().SingleAsync(a => a.UserId == userId);
        _versionIds.Add(analysis.VersionId!.Value);
        return (analysis.VersionId!.Value, analysis.Id, userId, user.Email);
    }

    // Reads the live snapshot.json (if present) and returns the asset keys it
    // names, in a fixed order (audio, spectrogram, waveform, peaks — omitting
    // any that are absent). IFileStorage has no directory-listing API, so
    // reading the pointer document is the only way to discover exactly what
    // an export wrote — used both for content assertions and for this test
    // class's own cleanup list.
    private static async Task<(string? AudioKey, List<string> ImageKeys)> ReadAssetKeysAsync(
        WebApplicationFactory<Program> f, string snapshotKey)
    {
        using var scope = f.Services.CreateScope();
        var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
        if (!await storage.ExistsAsync(snapshotKey)) return (null, []);
        await using var stream = await storage.OpenReadAsync(snapshotKey);
        using var doc = await JsonDocument.ParseAsync(stream);
        var root = doc.RootElement;
        var audioKey = root.GetProperty("version").GetProperty("audioKey").GetString();
        var images = new List<string>();
        var an = root.GetProperty("analysis");
        foreach (var prop in new[] { "spectrogramImageKey", "waveformImageKey", "waveformPeaksKey" })
            if (an.TryGetProperty(prop, out var el) && el.ValueKind == JsonValueKind.String)
                images.Add(el.GetString()!);
        return (audioKey, images);
    }

    private void TrackAssets(string? audioKey, IEnumerable<string> imageKeys)
    {
        if (audioKey is not null) _assetKeys.Add(audioKey);
        _assetKeys.AddRange(imageKeys);
    }

    private static async Task<byte[]> ReadBytesAsync(WebApplicationFactory<Program> f, string key)
    {
        using var scope = f.Services.CreateScope();
        var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
        await using var s = await storage.OpenReadAsync(key);
        using var ms = new MemoryStream();
        await s.CopyToAsync(ms);
        return ms.ToArray();
    }

    [SkippableFact]
    public async Task Export_Requires_The_Admin_Key()
    {
        await TestDb.RequireAsync(factory); var f = Build();
        var r = await f.CreateClient().PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId = Guid.NewGuid() });
        Assert.Equal(HttpStatusCode.Unauthorized, r.StatusCode);
    }

    [SkippableFact]
    public async Task Export_Refuses_An_Untriaged_Analysis()
    {
        await TestDb.RequireAsync(factory); var f = Build(); var (versionId, analysisId, _, _) = await SeedAnalyzedAsync(f);
        await SetAsync(f, analysisId, a => a.RoutingPlan = null);
        var r = await Admin(f).PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId, reason = "t" });
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode); Assert.Equal("snapshot_not_ready", await Code(r));
    }

    [SkippableFact]
    public async Task Export_Refuses_A_Degraded_Analysis()
    {
        await TestDb.RequireAsync(factory); var f = Build(); var (versionId, analysisId, _, _) = await SeedAnalyzedAsync(f);
        await SetAsync(f, analysisId, a => a.DegradationNotice = "{\"reason\":\"tier_budget\"}");
        var r = await Admin(f).PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId, reason = "t" });
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode); Assert.Equal("snapshot_not_ready", await Code(r));
    }

    [SkippableFact]
    public async Task Export_Aborts_When_The_Owner_Would_Leak()
    {
        await TestDb.RequireAsync(factory); var f = Build(); var (versionId, analysisId, _, email) = await SeedAnalyzedAsync(f);
        await SetAsync(f, analysisId, a => a.FinalJson = "{\"note\":\"" + email + "\"}");
        var r = await Admin(f).PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId, reason = "t" });
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode); Assert.Equal("snapshot_leak", await Code(r));
    }

    // ── Item 3 — reason is required, same convention as every other admin mutation ──
    [SkippableFact]
    public async Task Export_Requires_A_Reason()
    {
        await TestDb.RequireAsync(factory); var f = Build();
        var r = await Admin(f).PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId = Guid.NewGuid(), reason = "" });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal("reason_required", await Code(r));
    }

    // ── Item 4 — Demo:SnapshotKey="" is the documented disable value ──
    [SkippableFact]
    public async Task Explicitly_Disabled_Key_Refuses_The_Export()
    {
        await TestDb.RequireAsync(factory);
        var f = factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Admin:ApiKey", Key);
            b.UseSetting("Demo:SnapshotKey", "");
        });
        var (versionId, _, _, _) = await SeedAnalyzedAsync(f);
        var r = await Admin(f).PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId, reason = "t" });
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
        Assert.Equal("demo_snapshot_disabled", await Code(r));
    }

    // A MISSING config value falls back to DemoSnapshotFormat.DefaultKey —
    // exercised at the unit level against the pure ResolveSnapshotKey helper,
    // never over HTTP: a real POST that resolved to the default key would
    // write into the REAL production audio/demo/snapshot/ path, which no
    // test may ever touch (a developer's machine can have a real snapshot
    // installed there).
    [Fact]
    public void Missing_Configured_Key_Falls_Back_To_The_Default()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>()).Build();
        var (key, error) = AdminEndpoints.ResolveSnapshotKey(config);
        Assert.Null(error);
        Assert.Equal(DemoSnapshotFormat.DefaultKey, key);
    }

    [Fact]
    public void Empty_Configured_Key_Resolves_To_The_Disabled_Error()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Demo:SnapshotKey"] = "" }).Build();
        var (key, error) = AdminEndpoints.ResolveSnapshotKey(config);
        Assert.Null(key);
        Assert.NotNull(error);
    }

    // ── Item 1 — the destination itself must be validated before ANY write ──
    [SkippableTheory]
    [InlineData("audio/other/snapshot.json")]           // wrong prefix entirely
    [InlineData("/audio/demo/x.json")]                  // leading slash
    [InlineData("audio\\demo\\x.json")]                 // backslashes, not POSIX-style
    [InlineData("audio/demo/../users/x.json")]           // parent-traversal segment
    public async Task Export_Refuses_A_Key_Outside_The_Shared_Prefix(string badKey)
    {
        await TestDb.RequireAsync(factory);
        var f = factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Admin:ApiKey", Key);
            b.UseSetting("Demo:SnapshotKey", badKey);
        });
        var (versionId, _, _, _) = await SeedAnalyzedAsync(f);
        var r = await Admin(f).PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId, reason = "t" });
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
        Assert.Equal("snapshot_key_invalid", await Code(r));
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False(await db.AuditLogs.AnyAsync(a => a.Action == "demo_snapshot_export" && a.Target == versionId.ToString()));
    }

    // ── Item 2(a)+(c) — a second export retires the first's assets; every asset key is fresh and id-free ──
    [SkippableFact]
    public async Task Second_Export_Retires_The_Firsts_Assets_And_Keys_Stay_Id_Free()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        var (versionId, _, _, _) = await SeedAnalyzedAsync(f);
        var snapshotKey = _dir + "snapshot.json";

        var r1 = await Admin(f).PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId, reason = "first" });
        r1.EnsureSuccessStatusCode();
        var (audioKeyA, _) = await ReadAssetKeysAsync(f, snapshotKey);
        Assert.NotNull(audioKeyA);

        var r2 = await Admin(f).PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId, reason = "second" });
        r2.EnsureSuccessStatusCode();
        var (audioKeyB, imagesB) = await ReadAssetKeysAsync(f, snapshotKey);
        Assert.NotNull(audioKeyB);
        TrackAssets(audioKeyB, imagesB);

        Assert.NotEqual(audioKeyA, audioKeyB);
        using var scope = f.Services.CreateScope();
        var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
        Assert.True(await storage.ExistsAsync(audioKeyB!));
        Assert.False(await storage.ExistsAsync(audioKeyA!)); // A's asset object is gone

        Assert.True(DemoSnapshotStore.IsSharedKey(audioKeyB!));
        Assert.DoesNotContain(versionId.ToString("D"), audioKeyB, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(versionId.ToString("N"), audioKeyB, StringComparison.OrdinalIgnoreCase);
    }

    // ── Item 2(b) — an aborted (leaking) export never touches the live snapshot ──
    [SkippableFact]
    public async Task Aborted_Leak_Export_Leaves_The_Live_Snapshot_Serving()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        var (versionId, analysisId, _, email) = await SeedAnalyzedAsync(f);
        var snapshotKey = _dir + "snapshot.json";

        var r1 = await Admin(f).PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId, reason = "first" });
        r1.EnsureSuccessStatusCode();
        var (audioKeyA, imagesA) = await ReadAssetKeysAsync(f, snapshotKey);
        TrackAssets(audioKeyA, imagesA);
        var beforeBytes = await ReadBytesAsync(f, snapshotKey);

        await SetAsync(f, analysisId, a => a.FinalJson = "{\"note\":\"" + email + "\"}");
        var r2 = await Admin(f).PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId, reason = "leaky" });
        Assert.Equal(HttpStatusCode.Conflict, r2.StatusCode);
        Assert.Equal("snapshot_leak", await Code(r2));

        using (var scope = f.Services.CreateScope())
        {
            var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
            Assert.True(await storage.ExistsAsync(audioKeyA!));
        }
        Assert.Equal(beforeBytes, await ReadBytesAsync(f, snapshotKey)); // pointer document byte-for-byte unchanged

        // A NEW account still seeds correctly from the untouched live snapshot.
        var (newUserId, _) = await TestAuth.RegisterAsync(f.CreateClient());
        _userIds.Add(newUserId);
        using var scope2 = f.Services.CreateScope();
        var seeder = scope2.ServiceProvider.GetRequiredService<DemoSeeder>();
        var found = await seeder.FindAsync(newUserId);
        Assert.NotNull(found);
        Assert.True(found!.FromSnapshot);
    }

    // ── Item 6 — the size cap is refused, self-cleans, and the previous live snapshot is untouched ──
    [SkippableFact]
    public async Task Export_Refuses_An_Oversized_Document_And_Leaves_The_Previous_Snapshot_Untouched()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        var (versionId, _, _, _) = await SeedAnalyzedAsync(f);
        var snapshotKey = _dir + "snapshot.json";

        var first = await Admin(f).PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId, reason = "install" });
        first.EnsureSuccessStatusCode();
        var beforeBytes = await ReadBytesAsync(f, snapshotKey);
        var (beforeAudioKey, beforeImages) = await ReadAssetKeysAsync(f, snapshotKey);
        TrackAssets(beforeAudioKey, beforeImages);

        // Same dir, tiny cap — the live snapshot from `first` is at risk if this isn't atomic.
        var f2 = factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Admin:ApiKey", Key);
            b.UseSetting("Demo:SnapshotKey", snapshotKey);
            b.UseSetting("Demo:SnapshotExportMaxBytes", "100");
        });
        var r = await Admin(f2).PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId, reason = "too big" });
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
        Assert.Equal("snapshot_too_large", await Code(r));

        Assert.Equal(beforeBytes, await ReadBytesAsync(f, snapshotKey));
        using var scope = f.Services.CreateScope();
        var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
        Assert.True(await storage.ExistsAsync(beforeAudioKey!));
    }

    // ── Item 5 (content, not existence) + Item 7 (free-text disclosure) ──
    [SkippableFact]
    public async Task Export_Round_Trip_Preserves_Content_With_Fresh_Ids_And_Discloses_Free_Text()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        var (versionId, analysisId, userId, _) = await SeedAnalyzedAsync(f);
        var snapshotKey = _dir + "snapshot.json";

        const string verdict1Id = "vrd_01ROUNDTRIPAAAAAAAAAAAAAAA";
        const string verdict2Id = "vrd_01ROUNDTRIPBBBBBBBBBBBBBB";
        string sourceSongName;

        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();

            db.Verdicts.Add(new Verdict
            {
                Id = verdict1Id, AnalysisId = analysisId, Specialist = "low_end", PromptVersion = "low_end@1.0.0",
                Model = "fixture", Severity = "moderate", Category = "low_end", Confidence = 0.8, PriorityScore = 90,
                Headline = "Sub build-up", Evidence = "[]", Sources = "[]",
                Fix = "{\"ops\":[{\"type\":\"peaking_eq\",\"frequency_hz\":45,\"gain_db\":-3,\"q\":1.2}]}",
            });
            db.Verdicts.Add(new Verdict
            {
                Id = verdict2Id, AnalysisId = analysisId, Specialist = "true_peak", PromptVersion = "rule@1",
                Model = "rule", Severity = "minor", Category = "loudness", Confidence = 0.9, PriorityScore = 40,
                Headline = "True peak high", Evidence = "[]", Sources = "[]",
            });

            var conversation = new Conversation { Id = Guid.NewGuid(), AnalysisId = analysisId, UserId = userId };
            db.Conversations.Add(conversation);
            var t0 = DateTimeOffset.UtcNow;
            db.CoachMessages.Add(new CoachMessage
            {
                Id = Guid.NewGuid(), ConversationId = conversation.Id, Role = "user", Status = "complete", Mode = "qa",
                Content = "What's wrong with the low end?", CreatedAt = t0, CompletedAt = t0,
            });
            db.CoachMessages.Add(new CoachMessage
            {
                Id = Guid.NewGuid(), ConversationId = conversation.Id, Role = "assistant", Status = "complete", Mode = "qa",
                Content = $"Tame the sub build-up ({verdict1Id}).",
                Evidence = "[{\"label\":\"sub build-up\",\"verdictId\":\"" + verdict1Id + "\"}]",
                CreatedAt = t0.AddSeconds(1), CompletedAt = t0.AddSeconds(1),
            });
            db.CoachMessages.Add(new CoachMessage
            {
                Id = Guid.NewGuid(), ConversationId = conversation.Id, Role = "user", Status = "complete", Mode = "qa",
                Content = "Anything else?", CreatedAt = t0.AddSeconds(2), CompletedAt = t0.AddSeconds(2),
            });

            db.RackPresets.Add(new RackPreset
            {
                Id = Guid.NewGuid(), SongVersionId = versionId, Name = "My Fix Rack", Source = "user",
                ChainJson = "{\"order\":[\"eq\",\"comp\"],\"modules\":{\"eq\":{\"enabled\":true},\"comp\":{\"enabled\":true}},\"masterBypass\":false}",
            });

            var srcSpectro = _dir + "source-assets/spectrogram.webp";
            var srcWaveform = _dir + "source-assets/waveform.webp";
            var srcPeaks = _dir + "source-assets/peaks.json";
            await storage.WriteAsync(srcSpectro, new MemoryStream("SPEC"u8.ToArray()), "image/webp");
            await storage.WriteAsync(srcWaveform, new MemoryStream("WAVE"u8.ToArray()), "image/webp");
            await storage.WriteAsync(srcPeaks, new MemoryStream("{\"peaks\":[]}"u8.ToArray()), "application/json");

            const string routingPlan =
                "{\"specialists_to_run\":["
                + "{\"name\":\"low_end\",\"priority\":1,\"focus\":\"kick-bass\"},"
                + "{\"name\":\"width\",\"priority\":2,\"focus\":\"stereo\"}],"
                + "\"skip\":[],\"rationale\":\"r\",\"estimated_total_tokens\":100}";

            var a = await db.Analyses.SingleAsync(x => x.Id == analysisId);
            a.RoutingPlan = routingPlan;
            a.SpectrogramImagePath = srcSpectro;
            a.WaveformImagePath = srcWaveform;
            a.WaveformPeaksPath = srcPeaks;
            sourceSongName = a.SongName!;
            await db.SaveChangesAsync();
        }

        var r = await Admin(f).PostAsJsonAsync("/api/admin/demo/snapshot", new { versionId, reason = "rich export" });
        r.EnsureSuccessStatusCode();
        var body = await r.Content.ReadFromJsonAsync<DemoSnapshotExportResponse>();
        Assert.StartsWith("audio/demo/", body!.SnapshotKey);
        Assert.True(body.AudioBytes > 0);
        Assert.Equal(2, body.Verdicts);
        Assert.Equal(3, body.Messages);
        Assert.Equal(1, body.RackPresets);

        // Item 7 — free-text disclosure: exactly the human-typed strings, no filtering.
        Assert.Equal(sourceSongName, body.FreeText.Title);
        Assert.Equal(["My Fix Rack"], body.FreeText.RackPresetNames);
        Assert.Equal(["What's wrong with the low end?", "Anything else?"], body.FreeText.UserMessages);

        var (audioKey, imageKeys) = await ReadAssetKeysAsync(f, snapshotKey);
        TrackAssets(audioKey, imageKeys);
        Assert.Equal(3, imageKeys.Count);

        var (newUserId, _) = await TestAuth.RegisterAsync(f.CreateClient());
        _userIds.Add(newUserId);
        using var scope2 = f.Services.CreateScope();
        var db2 = scope2.ServiceProvider.GetRequiredService<AppDbContext>();
        var newAnalysis = await db2.Analyses.AsNoTracking().SingleAsync(x => x.UserId == newUserId);
        var newVerdicts = await db2.Verdicts.AsNoTracking()
            .Where(v => v.AnalysisId == newAnalysis.Id).OrderBy(v => v.CreatedAt).ToListAsync();
        Assert.Equal(2, newVerdicts.Count);
        var newFixVerdict = Assert.Single(newVerdicts, v => v.Fix is not null);
        // Structural, not textual — postgres jsonb re-canonicalizes stored
        // JSON (key order, whitespace) on every round trip through the
        // column, so a raw substring match on Fix text is inherently fragile.
        using (var fixDoc = JsonDocument.Parse(newFixVerdict.Fix!))
        {
            var op = fixDoc.RootElement.GetProperty("ops")[0];
            Assert.Equal("peaking_eq", op.GetProperty("type").GetString());
            Assert.Equal(45, op.GetProperty("frequency_hz").GetInt32());
        }

        var newConvo = await db2.Conversations.AsNoTracking().SingleAsync(c => c.UserId == newUserId);
        var newMsgs = await db2.CoachMessages.AsNoTracking()
            .Where(m => m.ConversationId == newConvo.Id).OrderBy(m => m.CreatedAt).ToListAsync();
        Assert.Equal(["user", "assistant", "user"], newMsgs.Select(m => m.Role));
        Assert.Equal("What's wrong with the low end?", newMsgs[0].Content);
        Assert.Equal("Anything else?", newMsgs[2].Content);

        var newLowEndVerdict = newVerdicts.Single(v => v.Specialist == "low_end");
        Assert.NotEqual(verdict1Id, newLowEndVerdict.Id);
        Assert.Contains(newLowEndVerdict.Id, newMsgs[1].Evidence);          // remapped to the NEW verdict id
        Assert.DoesNotContain(verdict1Id, newMsgs[1].Evidence);             // never the source id
        Assert.Contains(newLowEndVerdict.Id, newMsgs[1].Content);           // prose remapped too

        var newPreset = await db2.RackPresets.AsNoTracking().SingleAsync(p => p.SongVersionId == newAnalysis.VersionId);
        Assert.Equal("My Fix Rack", newPreset.Name);
        Assert.Contains("\"eq\"", newPreset.ChainJson);
        Assert.Contains("\"comp\"", newPreset.ChainJson);

        var newVersion = await db2.SongVersions.AsNoTracking().SingleAsync(v => v.Id == newAnalysis.VersionId);
        Assert.Equal(audioKey, newVersion.FilePath);
        Assert.Equal(imageKeys[0], newAnalysis.SpectrogramImagePath);
        Assert.Equal(imageKeys[1], newAnalysis.WaveformImagePath);
        Assert.Equal(imageKeys[2], newAnalysis.WaveformPeaksPath);

        // Routing plan kept only the covered specialist ("low_end"); "width" (uncovered) dropped.
        using (var planDoc = JsonDocument.Parse(newAnalysis.RoutingPlan!))
        {
            var entries = planDoc.RootElement.GetProperty("specialists_to_run").EnumerateArray().ToList();
            Assert.Single(entries);
            Assert.Equal("low_end", entries[0].GetProperty("name").GetString());
        }

        // No source id (song/version/job/analysis, either Guid form) anywhere in the new user's rows.
        var forbidden = new[]
        {
            versionId.ToString("D"), versionId.ToString("N"),
            analysisId.ToString("D"), analysisId.ToString("N"),
        };
        var blob = string.Join('\n',
            newAnalysis.FinalJson, newAnalysis.RoutingPlan,
            string.Join(',', newVerdicts.Select(v => v.Evidence + v.Fix)),
            string.Join(',', newMsgs.Select(m => m.Content + m.Evidence)),
            newPreset.ChainJson);
        foreach (var id in forbidden)
            Assert.DoesNotContain(id, blob, StringComparison.OrdinalIgnoreCase);
    }

    // The class deletes its own snapshot-directory objects (and every DB row
    // its tests created) after each test — never touches the shared canonical
    // demo audio/report, and always writes under a per-test-run
    // audio/demo/test-snapshots/<guid>/ prefix, never the real installed
    // audio/demo/snapshot/. IFileStorage has no prefix/listing API, so the
    // "directory" delete is: every asset key an export in this test actually
    // named (captured by reading its snapshot.json — TrackAssets) plus the
    // fixed pointer/staging filenames this test suite knows it can write.
    public async Task DisposeAsync()
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await TestAuth.AllowPurgeAsync(db);

        if (_dir is not null)
        {
            var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
            foreach (var key in _assetKeys.Distinct())
                await storage.DeleteAsync(key);
            await storage.DeleteAsync(_dir + "snapshot.json");
            await storage.DeleteAsync(_dir + "source-assets/spectrogram.webp");
            await storage.DeleteAsync(_dir + "source-assets/waveform.webp");
            await storage.DeleteAsync(_dir + "source-assets/peaks.json");
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
