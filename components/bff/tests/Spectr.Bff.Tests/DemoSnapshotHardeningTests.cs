using System.Net.Http.Headers; using System.Text; using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing; using Microsoft.AspNetCore.TestHost; using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection; using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.Services; using Spectr.Data; using Spectr.Data.Entities; using Xunit;
namespace Spectr.Bff.Tests;

// Fix-round-2: additional hardening cases against malformed/edge-case
// snapshots. Split out of DemoSnapshotSeedTests.cs (which was already near
// ~500 lines) — reuses DemoSnapshotFixture and
// DemoSnapshotSeedTests.CleanupAsync rather than duplicating either.
public sealed class DemoSnapshotHardeningTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
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

    [SkippableFact]
    public async Task Snapshot_With_A_NonArray_SpecialistsToRun_Is_Rewritten_To_An_Empty_Array()
    {
        // Item 1 — `specialists_to_run` present but NOT an array (string,
        // number, object, null) must be replaced with [], not passed
        // through: VerdictEndpoints' RoutingPlanDto expects a list, and a
        // non-list value there would 500 every guest's GET …/verdicts.
        await TestDb.RequireAsync(factory);
        var dir = $"audio/demo/test-snapshots/{Guid.NewGuid():N}/";
        const string malformedPlan =
            "{\"specialists_to_run\":\"low_end\",\"skip\":[],\"rationale\":\"bad shape\",\"estimated_total_tokens\":0}";
        var (f, q) = Build(dir + "snapshot.json");
        using (var scope = f.Services.CreateScope())
            await scope.ServiceProvider.GetRequiredService<IFileStorage>().WriteAsync(dir + "snapshot.json",
                new MemoryStream(Encoding.UTF8.GetBytes(DemoSnapshotFixture.Json(dir + "source.wav", malformedPlan))),
                "application/json");
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
            {
                var specialistsToRun = raw.RootElement.GetProperty("specialists_to_run");
                Assert.Equal(JsonValueKind.Array, specialistsToRun.ValueKind);
                Assert.Equal(0, specialistsToRun.GetArrayLength());
            }

            var resp = await client.GetAsync($"/api/reports/{analysis.JobId}/verdicts/");
            resp.EnsureSuccessStatusCode();
            using var body = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            var wireSpecialistsToRun = body.RootElement.GetProperty("routingPlan").GetProperty("specialistsToRun");
            Assert.Equal(JsonValueKind.Array, wireSpecialistsToRun.ValueKind);
            Assert.Equal(0, wireSpecialistsToRun.GetArrayLength());
            Assert.DoesNotContain(DramatiqTasks.RunTriage, q.Tasks);
        }
        finally
        {
            using var scope = f.Services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<IFileStorage>().DeleteAsync(dir + "snapshot.json");
            await DemoSnapshotSeedTests.CleanupAsync(f, userId);
        }
    }

    [SkippableFact]
    public async Task FindAsync_Is_Deterministic_When_Two_Demo_Songs_Share_The_Same_CreatedAt()
    {
        // Item 2 — a CreatedAt tie must not make FindAsync's answer
        // unspecified. Verify against an INDEPENDENT query using the exact
        // same ordering rule (CreatedAt asc, Id asc) rather than predicting
        // "the lower guid" via .NET's Guid.CompareTo — Postgres orders
        // uuid columns byte-wise (RFC 4122 network order), which does NOT
        // always agree with .NET's field-wise Guid comparison, so asserting
        // against a parallel EF query (translated the same way FindAsync's
        // query is) is what actually pins down "the rule", not luck.
        await TestDb.RequireAsync(factory);
        var (f, _) = Build(""); // sine-tone fallback — simplest seed
        Guid userId = default;
        try
        {
            var client = f.CreateClient();
            (userId, _) = await TestAuth.RegisterAsync(client);
            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var seeded = await db.Songs.AsNoTracking().SingleAsync(s => s.UserId == userId);

            // A second, FULLY-FORMED "Demo: "-prefixed song — its own
            // current version + job, so EITHER candidate resolves to a
            // complete DemoSeedResult regardless of which random Guid
            // happens to sort first. Without this, whichever song the
            // tie-break picks when it's the (version-less) tie row would
            // make FindAsync legitimately return null — a test-fixture gap,
            // not the thing item 2 is about (WHICH song wins the tie).
            var tie = new Song
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                Name = "Demo: also mine",
                CreatedAt = seeded.CreatedAt, // IDENTICAL — forces the tie
            };
            var tieVersion = new SongVersion
            {
                Id = Guid.NewGuid(),
                SongId = tie.Id,
                VersionNumber = 1,
                Label = "demo",
                IsCurrent = true,
                FilePath = "audio/demo/tie-song.wav",
            };
            var tieJob = new AnalysisJob
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                VersionId = tieVersion.Id,
                Status = "complete",
                CurrentPhase = "complete",
                PhasePct = 1.0,
            };
            db.Songs.Add(tie);
            db.SongVersions.Add(tieVersion);
            db.AnalysisJobs.Add(tieJob);
            await db.SaveChangesAsync();

            var expected = await db.Songs.AsNoTracking()
                .Where(s => s.UserId == userId && s.Name.StartsWith(DemoSeeder.DemoSongPrefix))
                .OrderBy(s => s.CreatedAt).ThenBy(s => s.Id)
                .FirstAsync();

            var seeder = scope.ServiceProvider.GetRequiredService<DemoSeeder>();
            var first = await seeder.FindAsync(userId);
            var second = await seeder.FindAsync(userId);
            Assert.NotNull(first);
            Assert.NotNull(second);
            Assert.Equal(expected.Id, first!.SongId);
            Assert.Equal(first.SongId, second!.SongId); // stable across calls
        }
        finally
        {
            await DemoSnapshotSeedTests.CleanupAsync(f, userId);
        }
    }

    [SkippableTheory]
    [InlineData(null)]     // ABSENT — the "routingPlan" key is missing from the snapshot entirely
    [InlineData("null")]   // present, explicit JSON null
    [InlineData("\"x\"")]  // present, a JSON string (non-object)
    [InlineData("[]")]     // present, a JSON array (non-object)
    public async Task Snapshot_With_An_Unusable_Routing_Plan_Still_Seeds_One_And_Fires_No_Triage(string? routingPlanLiteral)
    {
        // Item 3 — the seeder is the LAST line of defence: a snapshot whose
        // analysis.routingPlan is missing/null/not-an-object must never
        // seed a NULL RoutingPlan (VerdictEndpoints.ListVerdicts lazy-fires
        // paid run_triage exactly when it's null), for every shape that can
        // fail JsonElement's `is { ValueKind: JsonValueKind.Object }` guard.
        await TestDb.RequireAsync(factory);
        var dir = $"audio/demo/test-snapshots/{Guid.NewGuid():N}/";
        var (f, q) = Build(dir + "snapshot.json");
        using (var scope = f.Services.CreateScope())
            await scope.ServiceProvider.GetRequiredService<IFileStorage>().WriteAsync(dir + "snapshot.json",
                new MemoryStream(Encoding.UTF8.GetBytes(DemoSnapshotFixture.Json(dir + "source.wav", routingPlanLiteral))),
                "application/json");
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
            Assert.NotNull(analysis.RoutingPlan);
            (await client.GetAsync($"/api/reports/{analysis.JobId}/verdicts/")).EnsureSuccessStatusCode();
            Assert.DoesNotContain(DramatiqTasks.RunTriage, q.Tasks);
        }
        finally
        {
            using var scope = f.Services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<IFileStorage>().DeleteAsync(dir + "snapshot.json");
            await DemoSnapshotSeedTests.CleanupAsync(f, userId);
        }
    }

    [SkippableFact]
    public async Task Snapshot_With_An_Overlong_Title_Truncates_The_Seeded_Song_Name()
    {
        // Item 4a — songs.name is varchar(200); a 300-char exported title
        // must truncate rather than 22001 the whole seed (degrading a
        // snapshot seed all the way to the sine-tone fallback).
        await TestDb.RequireAsync(factory);
        var dir = $"audio/demo/test-snapshots/{Guid.NewGuid():N}/";
        var longTitle = new string('A', 300);
        var (f, _) = Build(dir + "snapshot.json");
        using (var scope = f.Services.CreateScope())
            await scope.ServiceProvider.GetRequiredService<IFileStorage>().WriteAsync(dir + "snapshot.json",
                new MemoryStream(Encoding.UTF8.GetBytes(DemoSnapshotFixture.Json(dir + "source.wav", title: longTitle))),
                "application/json");
        Guid userId = default;
        try
        {
            (userId, _) = await TestAuth.RegisterAsync(f.CreateClient());
            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var song = await db.Songs.AsNoTracking().SingleAsync(s => s.UserId == userId);
            Assert.Equal(200, song.Name.Length);
            Assert.StartsWith(DemoSeeder.DemoSongPrefix, song.Name);

            var found = await scope.ServiceProvider.GetRequiredService<DemoSeeder>().FindAsync(userId);
            Assert.NotNull(found);
            Assert.True(found!.FromSnapshot); // the snapshot path was used, not the sine-tone fallback
        }
        finally
        {
            using var scope = f.Services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<IFileStorage>().DeleteAsync(dir + "snapshot.json");
            await DemoSnapshotSeedTests.CleanupAsync(f, userId);
        }
    }

    [SkippableFact]
    public async Task RackPresets_With_A_Null_Or_Absent_Chain_Are_Skipped_But_Others_Still_Seed()
    {
        // Item 4b — a null OR entirely-absent "chain" property must be
        // skipped (GetRawText() throws on the Undefined default a missing
        // property leaves behind); a preset with a real chain alongside
        // them must still seed.
        await TestDb.RequireAsync(factory);
        var dir = $"audio/demo/test-snapshots/{Guid.NewGuid():N}/";
        const string rackPresetsJson =
            "[{\"name\":\"Null Chain\",\"source\":\"analysis\",\"chain\":null,\"coachMeta\":null},"
            + "{\"name\":\"Absent Chain\",\"source\":\"analysis\",\"coachMeta\":null},"
            + "{\"name\":\"Good Chain\",\"source\":\"analysis\","
            + "\"chain\":{\"order\":[\"eq\"],\"modules\":{},\"masterBypass\":false},\"coachMeta\":null}]";
        var (f, _) = Build(dir + "snapshot.json");
        using (var scope = f.Services.CreateScope())
            await scope.ServiceProvider.GetRequiredService<IFileStorage>().WriteAsync(dir + "snapshot.json",
                new MemoryStream(Encoding.UTF8.GetBytes(DemoSnapshotFixture.Json(dir + "source.wav", rackPresetsJson: rackPresetsJson))),
                "application/json");
        Guid userId = default;
        try
        {
            (userId, _) = await TestAuth.RegisterAsync(f.CreateClient());
            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var version = await db.SongVersions.AsNoTracking()
                .SingleAsync(v => db.Songs.Any(s => s.Id == v.SongId && s.UserId == userId));
            var presets = await db.RackPresets.AsNoTracking().Where(p => p.SongVersionId == version.Id).ToListAsync();
            var preset = Assert.Single(presets);
            Assert.Equal("Good Chain", preset.Name);
        }
        finally
        {
            using var scope = f.Services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<IFileStorage>().DeleteAsync(dir + "snapshot.json");
            await DemoSnapshotSeedTests.CleanupAsync(f, userId);
        }
    }
}
