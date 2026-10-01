using System.Net.Http.Json;
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
using Spectr.Data.Migrations;
using Xunit;

namespace Spectr.Bff.Tests;

// Owner decision (2026-10): the demo song is GUEST-only. Covers the one-time
// backfill (migration RemoveDemoFromRegisteredLibraries) and the runtime
// helper (Spectr.Data.DemoLibraryCleanup, used on guest -> account
// conversion): a registered user's whole demo graph goes; a guest's demo,
// a registered user's own songs (even one NAMED "Demo: …") and the shared
// "audio/demo/" storage objects are untouched.
//
// The backfill SQL is run SCOPED to this test's own users (the template's
// {0} slot) so it never deletes other suites' rows in the shared test DB.
// "DemoAuth" collection: it mints a guest (users.is_guest) like the other
// demo-auth suites that count those rows.
[Collection("DemoAuth")]
public sealed class DemoLibraryCleanupTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private sealed class NoopQueue : IJobQueue
    {
        public Task EnqueueAsync(string t, object[] a, CancellationToken ct = default) => Task.CompletedTask;
        public Task EnqueueAsync(string t, object[] a, string q, CancellationToken ct = default) => Task.CompletedTask;
        public Task EnqueueDelayedAsync(string t, object[] a, string q, TimeSpan d, CancellationToken ct = default) => Task.CompletedTask;
    }

    private WebApplicationFactory<Program> Build() =>
        factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Demo:Enabled", "true");
            b.UseSetting("Demo:SnapshotKey", ""); // sine-tone fallback → shared audio/demo/source.wav
            b.ConfigureTestServices(s =>
            {
                s.RemoveAll(typeof(IJobQueue));
                s.AddSingleton<IJobQueue>(new NoopQueue());
            });
        });

    private sealed record DemoGraph(
        Guid SongId, Guid VersionId, Guid JobId, Guid AnalysisId,
        Guid ConversationId, string VerdictId, string LlmCallId);

    // Seeds the demo via the real seeder, then hangs the rest of the graph a
    // registered user could have accumulated on it (coach chat + an LLM call,
    // a verdict + user state, rack preset/draft, tag, session note).
    private static async Task<DemoGraph> SeedDemoGraphAsync(WebApplicationFactory<Program> f, Guid userId)
    {
        using var scope = f.Services.CreateScope();
        var seeded = await scope.ServiceProvider.GetRequiredService<DemoSeeder>().SeedAsync(userId);
        Assert.NotNull(seeded);
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var analysisId = await db.Analyses.Where(a => a.JobId == seeded!.JobId).Select(a => a.Id).SingleAsync();

        var llmId = $"test-{Guid.NewGuid():N}"[..36];
        db.LlmCalls.Add(new LlmCall
        {
            Id = llmId, UserId = userId, Purpose = "coach", Model = "test",
            CostUsd = 0.01m, Outcome = "ok",
        });
        var conv = new Conversation { AnalysisId = analysisId, UserId = userId };
        db.Conversations.Add(conv);
        db.CoachMessages.Add(new CoachMessage { ConversationId = conv.Id, Role = "user", Content = "why so loud?" });
        db.CoachMessages.Add(new CoachMessage { ConversationId = conv.Id, Role = "assistant", Content = "…", LlmCallId = llmId });
        var verdictId = $"v-{Guid.NewGuid():N}";
        db.Verdicts.Add(new Verdict
        {
            Id = verdictId, AnalysisId = analysisId, Specialist = "test", PromptVersion = "test@1",
            Model = "test", Severity = "minor", Category = "loudness", Headline = "h",
        });
        db.VerdictUserStates.Add(new VerdictUserState { VerdictId = verdictId, UserId = userId, Dismissed = true });
        db.RackPresets.Add(new RackPreset { SongVersionId = seeded!.VersionId, Name = "mine" });
        db.RackDrafts.Add(new RackDraft { SongVersionId = seeded.VersionId });
        db.SongTags.Add(new SongTag { SongId = seeded.SongId, UserId = userId, Name = "wip" });
        db.SessionNotes.Add(new SessionNote { VersionId = seeded.VersionId, UserId = userId, Text = "note" });
        await db.SaveChangesAsync();
        return new DemoGraph(seeded.SongId, seeded.VersionId, seeded.JobId, analysisId, conv.Id, verdictId, llmId);
    }

    private static async Task<bool> GraphGoneAsync(AppDbContext db, DemoGraph g) =>
        !await db.Songs.AnyAsync(s => s.Id == g.SongId)
        && !await db.SongVersions.AnyAsync(v => v.Id == g.VersionId)
        && !await db.AnalysisJobs.AnyAsync(j => j.Id == g.JobId)
        && !await db.Analyses.AnyAsync(a => a.Id == g.AnalysisId)
        && !await db.Conversations.AnyAsync(c => c.Id == g.ConversationId)
        && !await db.CoachMessages.AnyAsync(m => m.ConversationId == g.ConversationId)
        && !await db.Verdicts.AnyAsync(v => v.Id == g.VerdictId)
        && !await db.VerdictUserStates.AnyAsync(s => s.VerdictId == g.VerdictId)
        && !await db.RackPresets.AnyAsync(p => p.SongVersionId == g.VersionId)
        && !await db.RackDrafts.AnyAsync(d => d.SongVersionId == g.VersionId)
        && !await db.SongTags.AnyAsync(t => t.SongId == g.SongId)
        && !await db.SessionNotes.AnyAsync(n => n.VersionId == g.VersionId);

    private static async Task<bool> GraphIntactAsync(AppDbContext db, DemoGraph g) =>
        await db.Songs.AnyAsync(s => s.Id == g.SongId)
        && await db.SongVersions.AnyAsync(v => v.Id == g.VersionId)
        && await db.Analyses.AnyAsync(a => a.Id == g.AnalysisId)
        && await db.Conversations.AnyAsync(c => c.Id == g.ConversationId)
        && await db.Verdicts.AnyAsync(v => v.Id == g.VerdictId)
        && await db.RackPresets.AnyAsync(p => p.SongVersionId == g.VersionId);

    private static async Task<Guid> StartGuestAsync(WebApplicationFactory<Program> f)
    {
        var resp = await f.CreateClient().PostAsync("/api/auth/demo", null);
        resp.EnsureSuccessStatusCode();
        return (await resp.Content.ReadFromJsonAsync<DemoStartResponse>())!.User.Id;
    }

    [SkippableFact]
    public async Task Migration_Is_Applied_To_The_Test_Database()
    {
        await TestDb.RequireAsync(factory);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var applied = await db.Database.GetAppliedMigrationsAsync();
        Assert.Contains(applied, m => m.EndsWith("_RemoveDemoFromRegisteredLibraries", StringComparison.Ordinal));
    }

    [SkippableFact]
    public async Task Backfill_Removes_A_Registered_Users_Demo_Graph_And_Nothing_Else()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        Guid regId = default, guestId = default;
        var llmIds = new List<string>();
        try
        {
            (regId, _) = await TestAuth.RegisterAsync(f.CreateClient());
            var regDemo = await SeedDemoGraphAsync(f, regId);
            llmIds.Add(regDemo.LlmCallId);
            var (ownSongId, ownVersionId) = await TestSeed.SongWithVersionAsync(f, regId);
            // A real song the user NAMED like the demo (and even labeled
            // "demo") — its audio is their own upload, so it is not the seed.
            var (lookalikeSongId, lookalikeVersionId) = await TestSeed.SongWithVersionAsync(f, regId);
            // A demo song the user added a REAL version to — deleting it
            // would take their upload with it, so it is left alone.
            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                await db.Songs.Where(s => s.Id == lookalikeSongId)
                    .ExecuteUpdateAsync(s => s.SetProperty(x => x.Name, DemoSeeder.DemoSongPrefix + "my own mix"));
                await db.SongVersions.Where(v => v.Id == lookalikeVersionId)
                    .ExecuteUpdateAsync(s => s.SetProperty(x => x.Label, "demo"));
            }

            guestId = await StartGuestAsync(f);
            var guestDemo = await SeedDemoGraphAsync(f, guestId); // FindAsync path → same seeded demo
            llmIds.Add(guestDemo.LlmCallId);

            var storage = f.Services.GetRequiredService<IFileStorage>();
            var sizeBefore = await storage.GetFileSizeAsync(DemoSeeder.DemoAudioKey);
            Assert.NotNull(sizeBefore);

            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var sql = string.Format(RemoveDemoFromRegisteredLibraries.SqlTemplate,
                    $"AND s.user_id IN ('{regId}', '{guestId}')");
                var songsDeleted = await db.Database.ExecuteSqlRawAsync(sql);
                Assert.Equal(1, songsDeleted);

                Assert.True(await GraphGoneAsync(db, regDemo));
                Assert.True(await GraphIntactAsync(db, guestDemo));                 // guest untouched
                Assert.True(await db.SongVersions.AnyAsync(v => v.Id == ownVersionId)); // own songs untouched
                Assert.True(await db.Songs.AnyAsync(s => s.Id == ownSongId));
                Assert.True(await db.Songs.AnyAsync(s => s.Id == lookalikeSongId));
                Assert.True(await db.LlmCalls.AnyAsync(c => c.Id == regDemo.LlmCallId)); // cost history kept

                // Idempotent: a re-run matches nothing.
                Assert.Equal(0, await db.Database.ExecuteSqlRawAsync(sql));
            }

            // Shared demo storage never touched.
            Assert.Equal(sizeBefore, await storage.GetFileSizeAsync(DemoSeeder.DemoAudioKey));
        }
        finally
        {
            await CleanupAsync(f, llmIds, regId, guestId);
            f.Dispose();
        }
    }

    [SkippableFact]
    public async Task Backfill_Leaves_A_Demo_Song_The_User_Added_A_Real_Version_To()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        Guid regId = default;
        try
        {
            (regId, _) = await TestAuth.RegisterWithDemoAsync(f, f.CreateClient());
            Guid demoSongId;
            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                demoSongId = await db.Songs.Where(s => s.UserId == regId).Select(s => s.Id).SingleAsync();
                db.SongVersions.Add(new SongVersion
                {
                    SongId = demoSongId, VersionNumber = 2, Label = "v2", IsCurrent = false,
                    FilePath = $"audio/upload/{Guid.NewGuid()}/source.wav",
                });
                await db.SaveChangesAsync();

                var sql = string.Format(RemoveDemoFromRegisteredLibraries.SqlTemplate, $"AND s.user_id = '{regId}'");
                Assert.Equal(0, await db.Database.ExecuteSqlRawAsync(sql));
                Assert.Equal(2, await db.SongVersions.CountAsync(v => v.SongId == demoSongId));
            }
        }
        finally
        {
            await CleanupAsync(f, [], regId);
            f.Dispose();
        }
    }

    [SkippableFact]
    public async Task Runtime_Helper_Never_Touches_A_Guest_And_Clears_A_Registered_User()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        Guid regId = default, guestId = default;
        var llmIds = new List<string>();
        try
        {
            (regId, _) = await TestAuth.RegisterAsync(f.CreateClient());
            var regDemo = await SeedDemoGraphAsync(f, regId);
            guestId = await StartGuestAsync(f);
            var guestDemo = await SeedDemoGraphAsync(f, guestId);
            llmIds.AddRange([regDemo.LlmCallId, guestDemo.LlmCallId]);

            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Equal(0, await DemoLibraryCleanup.RemoveForUserAsync(db, guestId)); // still a guest
            Assert.True(await GraphIntactAsync(db, guestDemo));
            Assert.Equal(1, await DemoLibraryCleanup.RemoveForUserAsync(db, regId));
            Assert.True(await GraphGoneAsync(db, regDemo));
            Assert.True(await f.Services.GetRequiredService<IFileStorage>().ExistsAsync(DemoSeeder.DemoAudioKey));
        }
        finally
        {
            await CleanupAsync(f, llmIds, regId, guestId);
            f.Dispose();
        }
    }

    private static async Task CleanupAsync(WebApplicationFactory<Program> f, List<string> llmIds, params Guid[] userIds)
    {
        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await TestAuth.AllowPurgeAsync(db);
            foreach (var id in userIds.Where(i => i != default))
            {
                await db.SessionNotes.Where(n => n.UserId == id).ExecuteDeleteAsync();
                await db.VerdictUserStates.Where(s => s.UserId == id).ExecuteDeleteAsync();
                await db.CreditLedger.Where(e => e.UserId == id).ExecuteDeleteAsync();
                await db.AuthTokens.Where(t => t.UserId == id).ExecuteDeleteAsync();
            }
            if (llmIds.Count > 0)
                await db.LlmCalls.Where(c => llmIds.Contains(c.Id)).ExecuteDeleteAsync();
        }
        await DemoAuthEndpointsTests.CleanupAsync(f, userIds);
    }
}
