using System.Net.Http.Headers; using System.Text; using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing; using Microsoft.AspNetCore.TestHost; using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection; using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.Services; using Spectr.Data; using Spectr.Data.Entities; using Xunit;
namespace Spectr.Bff.Tests;
public sealed class DemoSnapshotSeedTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    internal sealed class RecordingQueue : IJobQueue
    {
        public readonly List<string> Tasks = [];
        public Task EnqueueAsync(string t, object[] a, CancellationToken ct = default) { Tasks.Add(t); return Task.CompletedTask; }
        public Task EnqueueAsync(string t, object[] a, string q, CancellationToken ct = default) { Tasks.Add(t); return Task.CompletedTask; }
        public Task EnqueueDelayedAsync(string t, object[] a, string q, TimeSpan d, CancellationToken ct = default) { Tasks.Add(t); return Task.CompletedTask; }
    }
    private (WebApplicationFactory<Program> F, RecordingQueue Q) Build(string snapshotKey)
    {
        var q = new RecordingQueue();
        var f = factory.WithWebHostBuilder(b => { b.UseSetting("Demo:SnapshotKey", snapshotKey);
            b.ConfigureTestServices(s => { s.RemoveAll(typeof(IJobQueue)); s.AddSingleton<IJobQueue>(q); }); });
        return (f, q);
    }

    // Fix-round-1 item 8: this suite seeds full rows (songs, versions, jobs,
    // analyses, verdicts, conversations, coach messages, rack presets) — the
    // dev DB has been bitten by leftover test rows before. Mirrors
    // DemoSeederTests.CleanupAsync, extended for the snapshot-only tables.
    // None of these tables carry DB-level FK constraints to each other
    // (Verdict/Conversation/CoachMessage/RackPreset are plain Guid columns,
    // no HasForeignKey mapping in AppDbContext), so deletion order is not
    // constrained.
    // Fix-round-2: internal (not private) so DemoSnapshotHardeningTests.cs
    // can reuse it instead of duplicating the delete cascade.
    internal static async Task CleanupAsync(WebApplicationFactory<Program> f, Guid userId)
    {
        if (userId == default) return;
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await TestAuth.AllowPurgeAsync(db);
        var analysisIds = await db.Analyses.Where(a => a.UserId == userId).Select(a => a.Id).ToListAsync();
        await db.Verdicts.Where(v => analysisIds.Contains(v.AnalysisId)).ExecuteDeleteAsync();
        var convoIds = await db.Conversations.Where(c => c.UserId == userId).Select(c => c.Id).ToListAsync();
        await db.CoachMessages.Where(m => convoIds.Contains(m.ConversationId)).ExecuteDeleteAsync();
        await db.Conversations.Where(c => c.UserId == userId).ExecuteDeleteAsync();
        await db.Analyses.Where(a => a.UserId == userId).ExecuteDeleteAsync();
        await db.AnalysisJobs.Where(j => j.UserId == userId).ExecuteDeleteAsync();
        var songIds = await db.Songs.Where(s => s.UserId == userId).Select(s => s.Id).ToListAsync();
        var versionIds = await db.SongVersions.Where(v => songIds.Contains(v.SongId)).Select(v => v.Id).ToListAsync();
        await db.RackPresets.Where(p => versionIds.Contains(p.SongVersionId)).ExecuteDeleteAsync();
        await db.SongVersions.Where(v => songIds.Contains(v.SongId)).ExecuteDeleteAsync();
        await db.Songs.Where(s => s.UserId == userId).ExecuteDeleteAsync();
        await db.RefreshTokens.Where(t => t.UserId == userId).ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
    }

    [SkippableFact]
    public async Task Registration_Seeds_From_The_Snapshot_With_Fresh_Ids_And_No_Triage()
    {
        await TestDb.RequireAsync(factory);
        var dir = $"audio/demo/test-snapshots/{Guid.NewGuid():N}/";
        var (f, q) = Build(dir + "snapshot.json");
        using (var scope = f.Services.CreateScope())
        {
            var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
            await storage.WriteAsync(dir + "source.wav", new MemoryStream(DemoSeeder.GenerateToneWav()), "audio/wav");
            await storage.WriteAsync(dir + "snapshot.json",
                new MemoryStream(Encoding.UTF8.GetBytes(DemoSnapshotFixture.Json(dir + "source.wav"))), "application/json");
        }
        Guid userId = default;
        try
        {
            var client = f.CreateClient();
            string token;
            (userId, token) = await TestAuth.RegisterAsync(client);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var song = await db.Songs.AsNoTracking().SingleAsync(s => s.UserId == userId);
            Assert.Equal("Demo: Fixture Track", song.Name);
            Assert.Equal("house", song.GenreHint); // item 6
            var analysis = await db.Analyses.AsNoTracking().SingleAsync(a => a.UserId == userId);
            Assert.NotEqual(Guid.Parse(DemoSnapshotFixture.SourceJob), analysis.JobId);
            Assert.Contains(analysis.JobId.ToString(), analysis.FinalJson);          // embedded id was remapped
            Assert.DoesNotContain(DemoSnapshotFixture.SourceJob, analysis.FinalJson);
            Assert.NotNull(analysis.RoutingPlan);

            // Items 2a/2b — the plan routed "low_end" (covered — a seeded
            // verdict has that slug) AND "stereo" (uncovered — no verdict).
            // The seeded plan must keep ONLY the covered entry.
            using (var raw = JsonDocument.Parse(analysis.RoutingPlan!))
            {
                var entries = raw.RootElement.GetProperty("specialists_to_run").EnumerateArray().ToList();
                Assert.Single(entries);
                Assert.Equal("low_end", entries[0].GetProperty("name").GetString());
            }

            // FindAsync must recognize this as a SNAPSHOT-origin seed (its
            // version never points at the shared sine-tone key).
            var found = await scope.ServiceProvider.GetRequiredService<DemoSeeder>().FindAsync(userId);
            Assert.NotNull(found);
            Assert.True(found!.FromSnapshot);
            Assert.Equal(song.Id, found.SongId);
            var verdicts = await db.Verdicts.AsNoTracking().Where(v => v.AnalysisId == analysis.Id).ToListAsync();
            Assert.Equal(2, verdicts.Count);
            Assert.All(verdicts, v => { Assert.StartsWith("vrd_", v.Id); Assert.DoesNotContain("SOURCE", v.Id); });
            Assert.Contains(verdicts, v => v.Fix is not null && v.Fix.Contains("peaking_eq"));
            var convo = await db.Conversations.AsNoTracking().SingleAsync(c => c.UserId == userId);
            var msgs = await db.CoachMessages.AsNoTracking().Where(m => m.ConversationId == convo.Id).OrderBy(m => m.CreatedAt).ToListAsync();
            Assert.Equal(new[] { "user", "assistant" }, msgs.Select(m => m.Role));
            Assert.Contains(verdicts.Single(v => v.Specialist == "low_end").Id, msgs[1].Content); // verdict id remapped inside prose too
            Assert.Null(msgs[1].LlmCallId);
            var preset = Assert.Single(await db.RackPresets.AsNoTracking().Where(p => p.SongVersionId == analysis.VersionId).ToListAsync());
            Assert.Equal("Fix Rack", preset.Name);           // item 6
            Assert.Contains("masterBypass", preset.ChainJson); // item 6
            Assert.False(await db.UsageEvents.AsNoTracking().AnyAsync(e => e.UserId == userId)); // seeded rows never meter

            var resp = await client.GetAsync($"/api/reports/{analysis.JobId}/verdicts/");
            resp.EnsureSuccessStatusCode();
            Assert.DoesNotContain(DramatiqTasks.RunTriage, q.Tasks);

            // Item 5 — the seeded plan round-trips through the endpoint's
            // parser with a NON-NULL specialistsToRun (the frontend
            // dereferences it unguarded: ReportView.tsx ~608, CoachTab.tsx ~135).
            using var body = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            var specialistsToRun = body.RootElement.GetProperty("routingPlan").GetProperty("specialistsToRun");
            Assert.Equal(JsonValueKind.Array, specialistsToRun.ValueKind);
            Assert.Equal(1, specialistsToRun.GetArrayLength());
            Assert.Equal("low_end", specialistsToRun[0].GetProperty("name").GetString());
        }
        finally
        {
            using var scope = f.Services.CreateScope();
            var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
            await storage.DeleteAsync(dir + "snapshot.json"); await storage.DeleteAsync(dir + "source.wav");
            await CleanupAsync(f, userId);
        }
    }

    // Fix-round-2 item 3: the "routing plan is missing/null/not-an-object"
    // family of cases moved to a parameterized theory in
    // DemoSnapshotHardeningTests.cs (Snapshot_With_An_Unusable_Routing_Plan_...).

    [SkippableFact]
    public async Task Snapshot_With_Zero_Covered_Specialists_Seeds_An_Empty_Roster_That_Still_Parses()
    {
        // Item 2c — a plan that routes ONLY uncovered specialists must come
        // out as specialists_to_run: [] (never omitted, never null), and
        // that empty array must still round-trip as a real (non-null) array
        // through VerdictEndpoints' parser to the frontend.
        await TestDb.RequireAsync(factory);
        var dir = $"audio/demo/test-snapshots/{Guid.NewGuid():N}/";
        var (f, _) = Build(dir + "snapshot.json");
        using (var scope = f.Services.CreateScope())
        {
            var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
            await storage.WriteAsync(dir + "snapshot.json",
                new MemoryStream(Encoding.UTF8.GetBytes(
                    DemoSnapshotFixture.Json(dir + "source.wav", DemoSnapshotFixture.UncoveredOnlyRoutingPlanJson))),
                "application/json");
        }
        Guid userId = default;
        try
        {
            var client = f.CreateClient();
            string token;
            (userId, token) = await TestAuth.RegisterAsync(client);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var scope = f.Services.CreateScope();
            var analysis = await scope.ServiceProvider.GetRequiredService<AppDbContext>()
                .Analyses.AsNoTracking().SingleAsync(a => a.UserId == userId);
            using (var raw = JsonDocument.Parse(analysis.RoutingPlan!))
                Assert.Equal(0, raw.RootElement.GetProperty("specialists_to_run").GetArrayLength());

            var resp = await client.GetAsync($"/api/reports/{analysis.JobId}/verdicts/");
            resp.EnsureSuccessStatusCode();
            using var body = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            var specialistsToRun = body.RootElement.GetProperty("routingPlan").GetProperty("specialistsToRun");
            Assert.Equal(JsonValueKind.Array, specialistsToRun.ValueKind);
            Assert.Equal(0, specialistsToRun.GetArrayLength());
        }
        finally
        {
            using var scope = f.Services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<IFileStorage>().DeleteAsync(dir + "snapshot.json");
            await CleanupAsync(f, userId);
        }
    }

    [SkippableFact]
    public async Task Asset_Keys_And_Metadata_Survive_Id_Remapping_Verbatim()
    {
        // Item 3 — the id-remapping pass replaces the four source Guids
        // EVERYWHERE in the raw document. An exporter layout that embeds the
        // version id inside an asset path must not have that segment
        // rewritten to a fresh, non-existent guid: every seeded row's asset
        // key must equal the ORIGINAL exported string exactly.
        await TestDb.RequireAsync(factory);
        var dir = $"audio/demo/test-snapshots/{Guid.NewGuid():N}/";
        var audioKey = $"{dir}{DemoSnapshotFixture.SourceVersion}/source.flac";
        var spectrogramKey = $"{dir}{DemoSnapshotFixture.SourceVersion}/spectrogram.webp";
        var waveformKey = $"{dir}{DemoSnapshotFixture.SourceVersion}/waveform.webp";
        var peaksKey = $"{dir}{DemoSnapshotFixture.SourceVersion}/peaks.json";
        var (f, _) = Build(dir + "snapshot.json");
        using (var scope = f.Services.CreateScope())
        {
            var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
            await storage.WriteAsync(dir + "snapshot.json",
                new MemoryStream(Encoding.UTF8.GetBytes(DemoSnapshotFixture.Json(
                    audioKey, DemoSnapshotFixture.RealRoutingPlanJson, spectrogramKey, waveformKey, peaksKey))),
                "application/json");
        }
        Guid userId = default;
        try
        {
            var (uid, _) = await TestAuth.RegisterAsync(f.CreateClient());
            userId = uid;
            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var version = await db.SongVersions.AsNoTracking()
                .SingleAsync(v => db.Songs.Any(s => s.Id == v.SongId && s.UserId == userId));
            Assert.Equal(audioKey, version.FilePath);

            var analysis = await db.Analyses.AsNoTracking().SingleAsync(a => a.UserId == userId);
            // Each in its OWN column — a swap between spectrogram/waveform/peaks fails this.
            Assert.Equal(spectrogramKey, analysis.SpectrogramImagePath);
            Assert.Equal(waveformKey, analysis.WaveformImagePath);
            Assert.Equal(peaksKey, analysis.WaveformPeaksPath);
        }
        finally
        {
            using var scope = f.Services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<IFileStorage>().DeleteAsync(dir + "snapshot.json");
            await CleanupAsync(f, userId);
        }
    }

    [SkippableFact]
    public async Task Fallback_Seed_Carries_A_Routing_Plan_So_Opening_It_Never_Pays_For_Triage()
    {
        await TestDb.RequireAsync(factory);
        var (f, q) = Build("");                                   // snapshot disabled → sine-tone fallback
        Guid userId = default;
        try
        {
            var client = f.CreateClient();
            string token;
            (userId, token) = await TestAuth.RegisterAsync(client);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var scope = f.Services.CreateScope();
            var analysis = await scope.ServiceProvider.GetRequiredService<AppDbContext>().Analyses.AsNoTracking().SingleAsync(a => a.UserId == userId);
            Assert.NotNull(analysis.RoutingPlan);
            // FindAsync must recognize this as a FALLBACK-origin seed (its
            // version points at the ONE shared sine-tone key).
            var found = await scope.ServiceProvider.GetRequiredService<DemoSeeder>().FindAsync(userId);
            Assert.NotNull(found);
            Assert.False(found!.FromSnapshot);
            (await client.GetAsync($"/api/reports/{analysis.JobId}/verdicts/")).EnsureSuccessStatusCode();
            Assert.DoesNotContain(DramatiqTasks.RunTriage, q.Tasks);
        }
        finally
        {
            await CleanupAsync(f, userId);
        }
    }

    [SkippableFact]
    public async Task FindAsync_Prefers_The_Earliest_Demo_Song_Over_A_Later_UserNamed_One()
    {
        // Item 7 — FindAsync orders CreatedAt ASCENDING: the seeded demo is
        // always the user's FIRST "Demo: "-prefixed song. A LATER song the
        // user happens to name "Demo: mine" must never shadow it (the guest
        // landing flow in task D5 depends on always finding the ORIGINAL seed).
        await TestDb.RequireAsync(factory);
        var (f, _) = Build(""); // sine-tone fallback — simplest seed for this test
        Guid userId = default;
        try
        {
            var client = f.CreateClient();
            (userId, _) = await TestAuth.RegisterAsync(client);
            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var seededSong = await db.Songs.AsNoTracking().SingleAsync(s => s.UserId == userId);

            db.Songs.Add(new Song
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                Name = "Demo: mine",
                CreatedAt = DateTimeOffset.UtcNow.AddMinutes(5),
            });
            await db.SaveChangesAsync();

            var found = await scope.ServiceProvider.GetRequiredService<DemoSeeder>().FindAsync(userId);
            Assert.NotNull(found);
            Assert.Equal(seededSong.Id, found!.SongId);
        }
        finally
        {
            await CleanupAsync(f, userId);
        }
    }

    [SkippableFact]
    public async Task A_Corrupt_Snapshot_Falls_Back_Instead_Of_Failing_Registration()
    {
        await TestDb.RequireAsync(factory);
        var key = $"audio/demo/test-snapshots/{Guid.NewGuid():N}/snapshot.json";
        var (f, _) = Build(key);
        using (var scope = f.Services.CreateScope())
            await scope.ServiceProvider.GetRequiredService<IFileStorage>().WriteAsync(key, new MemoryStream("{not json"u8.ToArray()), "application/json");
        Guid userId = default;
        try
        {
            (userId, _) = await TestAuth.RegisterAsync(f.CreateClient());
            using var s2 = f.Services.CreateScope();
            var song = await s2.ServiceProvider.GetRequiredService<AppDbContext>().Songs.AsNoTracking().SingleAsync(s => s.UserId == userId);
            Assert.Equal(DemoSeeder.DemoSongName, song.Name);
        }
        finally
        {
            using var s3 = f.Services.CreateScope();
            await s3.ServiceProvider.GetRequiredService<IFileStorage>().DeleteAsync(key);
            await CleanupAsync(f, userId);
        }
    }

    // ── D2-review addendum: the worker's is_shared_key() only protects
    // audio/demo/ from guest/retention purges. An operator-configured
    // Demo:SnapshotKey (or an asset key the snapshot JSON itself names)
    // outside that prefix would seed rows pointing at storage the very
    // first guest purge deletes for everyone — must be rejected the same
    // way as a missing/corrupt snapshot: log + fall back, never throw. ──
    // (These exercise DemoSnapshotStore directly — no user/rows are created.)

    [SkippableTheory]
    [InlineData("audio/other/snapshot.json")]           // wrong prefix entirely
    [InlineData("/audio/demo/x.json")]                  // leading slash
    [InlineData("audio\\demo\\x.json")]                 // backslashes, not POSIX-style
    [InlineData("audio/demo/../users/x.json")]           // parent-traversal segment
    public async Task Snapshot_Key_Outside_The_Shared_Prefix_Is_Rejected(string badKey)
    {
        await TestDb.RequireAsync(factory);
        var (f, _) = Build(badKey);
        using var scope = f.Services.CreateScope();
        var store = scope.ServiceProvider.GetRequiredService<DemoSnapshotStore>();
        Assert.Null(await store.GetAsync(CancellationToken.None));
    }

    [SkippableFact]
    public async Task Snapshot_Key_Under_The_Shared_Prefix_Loads()
    {
        await TestDb.RequireAsync(factory);
        var dir = $"audio/demo/test-snapshots/{Guid.NewGuid():N}/";
        var (f, _) = Build(dir + "snapshot.json");
        using (var scope = f.Services.CreateScope())
        {
            var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
            await storage.WriteAsync(dir + "source.wav", new MemoryStream(DemoSeeder.GenerateToneWav()), "audio/wav");
            await storage.WriteAsync(dir + "snapshot.json",
                new MemoryStream(Encoding.UTF8.GetBytes(DemoSnapshotFixture.Json(dir + "source.wav"))), "application/json");
        }
        try
        {
            using var scope = f.Services.CreateScope();
            var store = scope.ServiceProvider.GetRequiredService<DemoSnapshotStore>();
            var template = await store.GetAsync(CancellationToken.None);
            Assert.NotNull(template);
            Assert.Equal("Fixture Track", template!.Title);
        }
        finally
        {
            using var scope = f.Services.CreateScope();
            var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
            await storage.DeleteAsync(dir + "snapshot.json"); await storage.DeleteAsync(dir + "source.wav");
        }
    }

    [SkippableFact]
    public async Task Snapshot_Naming_An_Asset_Key_Outside_The_Shared_Prefix_Is_Rejected()
    {
        await TestDb.RequireAsync(factory);
        var dir = $"audio/demo/test-snapshots/{Guid.NewGuid():N}/";
        var (f, _) = Build(dir + "snapshot.json");
        using (var scope = f.Services.CreateScope())
        {
            var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
            // The CONFIG key is valid (under audio/demo/), but the snapshot's
            // OWN declared audio key points outside the shared prefix — must
            // reject the whole snapshot, never seed a row pointing at it.
            await storage.WriteAsync(dir + "snapshot.json",
                new MemoryStream(Encoding.UTF8.GetBytes(DemoSnapshotFixture.Json("audio/uploads/someone-elses-track.wav"))),
                "application/json");
        }
        try
        {
            using var scope = f.Services.CreateScope();
            var store = scope.ServiceProvider.GetRequiredService<DemoSnapshotStore>();
            Assert.Null(await store.GetAsync(CancellationToken.None));
        }
        finally
        {
            using var scope = f.Services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<IFileStorage>().DeleteAsync(dir + "snapshot.json");
        }
    }

}
