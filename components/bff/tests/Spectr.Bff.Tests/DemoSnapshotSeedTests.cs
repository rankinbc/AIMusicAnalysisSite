using System.Net.Http.Headers; using System.Text;
using Microsoft.AspNetCore.Mvc.Testing; using Microsoft.AspNetCore.TestHost; using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection; using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.Services; using Spectr.Data; using Xunit;
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
        try
        {
            var client = f.CreateClient();
            var (userId, token) = await TestAuth.RegisterAsync(client);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var song = await db.Songs.AsNoTracking().SingleAsync(s => s.UserId == userId);
            Assert.Equal("Demo: Fixture Track", song.Name);
            var analysis = await db.Analyses.AsNoTracking().SingleAsync(a => a.UserId == userId);
            Assert.NotEqual(Guid.Parse(DemoSnapshotFixture.SourceJob), analysis.JobId);
            Assert.Contains(analysis.JobId.ToString(), analysis.FinalJson);          // embedded id was remapped
            Assert.DoesNotContain(DemoSnapshotFixture.SourceJob, analysis.FinalJson);
            Assert.NotNull(analysis.RoutingPlan);
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
            Assert.Single(await db.RackPresets.AsNoTracking().Where(p => p.SongVersionId == analysis.VersionId).ToListAsync());
            Assert.False(await db.UsageEvents.AsNoTracking().AnyAsync(e => e.UserId == userId)); // seeded rows never meter
            var resp = await client.GetAsync($"/api/reports/{analysis.JobId}/verdicts/");
            resp.EnsureSuccessStatusCode();
            Assert.DoesNotContain(DramatiqTasks.RunTriage, q.Tasks);
        }
        finally
        {
            using var scope = f.Services.CreateScope();
            var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
            await storage.DeleteAsync(dir + "snapshot.json"); await storage.DeleteAsync(dir + "source.wav");
        }
    }
    [SkippableFact]
    public async Task Fallback_Seed_Carries_A_Routing_Plan_So_Opening_It_Never_Pays_For_Triage()
    {
        await TestDb.RequireAsync(factory);
        var (f, q) = Build("");                                   // snapshot disabled → sine-tone fallback
        var client = f.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
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
    [SkippableFact]
    public async Task A_Corrupt_Snapshot_Falls_Back_Instead_Of_Failing_Registration()
    {
        await TestDb.RequireAsync(factory);
        var key = $"audio/demo/test-snapshots/{Guid.NewGuid():N}/snapshot.json";
        var (f, _) = Build(key);
        using (var scope = f.Services.CreateScope())
            await scope.ServiceProvider.GetRequiredService<IFileStorage>().WriteAsync(key, new MemoryStream("{not json"u8.ToArray()), "application/json");
        var (userId, _) = await TestAuth.RegisterAsync(f.CreateClient());
        using var s2 = f.Services.CreateScope();
        var song = await s2.ServiceProvider.GetRequiredService<AppDbContext>().Songs.AsNoTracking().SingleAsync(s => s.UserId == userId);
        Assert.Equal(DemoSeeder.DemoSongName, song.Name);
        await s2.ServiceProvider.GetRequiredService<IFileStorage>().DeleteAsync(key);
    }

    // ── D2-review addendum: the worker's is_shared_key() only protects
    // audio/demo/ from guest/retention purges. An operator-configured
    // Demo:SnapshotKey (or an asset key the snapshot JSON itself names)
    // outside that prefix would seed rows pointing at storage the very
    // first guest purge deletes for everyone — must be rejected the same
    // way as a missing/corrupt snapshot: log + fall back, never throw. ──

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
