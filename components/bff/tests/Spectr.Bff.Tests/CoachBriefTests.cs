using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
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

// Task G3 — POST /api/coach/{analysisId}/brief: the coach's once-per-
// conversation opening brief. Rides the existing coach_reply actor through a
// server-authored trigger row; never shown, never metered, idempotent under
// concurrency via the partial unique index (see migration AddCoachBriefMode).
[Collection("DemoAuth")]
public sealed class CoachBriefTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private sealed class RecordingJobQueue : IJobQueue
    {
        public readonly System.Collections.Concurrent.ConcurrentQueue<(string Task, object[] Args, string Queue)> Calls = new();

        public Task EnqueueAsync(string taskName, object[] args, CancellationToken ct = default)
            => EnqueueAsync(taskName, args, DramatiqQueues.Default, ct);

        public Task EnqueueAsync(string taskName, object[] args, string queueName, CancellationToken ct = default)
        {
            if (taskName != DramatiqTasks.SendEmail)
                Calls.Enqueue((taskName, args, queueName));
            return Task.CompletedTask;
        }

        public Task EnqueueDelayedAsync(string taskName, object[] args, string queueName, TimeSpan delay, CancellationToken ct = default)
        {
            if (taskName != DramatiqTasks.SendEmail)
                Calls.Enqueue((taskName, args, queueName));
            return Task.CompletedTask;
        }
    }

    private (WebApplicationFactory<Program> Factory, RecordingJobQueue Queue) BuildWithFakeQueue()
    {
        var queue = new RecordingJobQueue();
        var f = factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Demo:Enabled", "true");
            b.UseSetting("Demo:SnapshotKey", "");
            b.ConfigureTestServices(s =>
            {
                s.RemoveAll(typeof(IJobQueue));
                s.AddSingleton<IJobQueue>(queue);
            });
        });
        return (f, queue);
    }

    // Seeds a completed analysis for `userId`. `routingPlan: null` reproduces
    // the "triage hasn't run yet" 409 case; `demoVersion: true` seeds a
    // version whose FilePath starts with audio/demo/ (the skip case).
    private static async Task<Guid> SeedAnalysisAsync(
        WebApplicationFactory<Program> f, Guid userId,
        string? routingPlan = "not-null", bool demoVersion = false)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var jobId = Guid.NewGuid();
        var song = new Song { Id = Guid.NewGuid(), UserId = userId, Name = "G3 brief test" };
        var version = new SongVersion
        {
            Id = Guid.NewGuid(),
            SongId = song.Id,
            FilePath = demoVersion ? "audio/demo/x.wav" : "audio/g3brief/x.wav",
            VersionNumber = 1,
        };
        db.Songs.Add(song);
        db.SongVersions.Add(version);
        db.AnalysisJobs.Add(new AnalysisJob { Id = jobId, UserId = userId, Status = "complete", VersionId = version.Id });
        var analysis = new Analysis
        {
            Id = Guid.NewGuid(),
            JobId = jobId,
            UserId = userId,
            VersionId = version.Id,
            FinalJson = "{}",
            PhaseDurations = "{}",
            RoutingPlan = routingPlan == "not-null" ? DemoSeedMapping.EmptyRoutingPlanJson : routingPlan,
        };
        db.Analyses.Add(analysis);
        await db.SaveChangesAsync();
        return analysis.Id;
    }

    private static async Task<(HttpClient Client, Guid UserId)> RegisterRealUserAsync(WebApplicationFactory<Program> f)
    {
        var client = f.CreateClient();
        var (uid, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return (client, uid);
    }

    private static async Task<(HttpClient Client, Guid UserId)> StartGuestAsync(WebApplicationFactory<Program> f)
    {
        var client = f.CreateClient();
        var resp = await client.PostAsync("/api/auth/demo", null);
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<DemoStartResponse>();
        client.DefaultRequestHeaders.Authorization = new("Bearer", body!.AccessToken);
        return (client, body.User.Id);
    }

    private static async Task CleanupUser(WebApplicationFactory<Program> factory, Guid userId)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var conversations = await db.Conversations.Where(c => c.UserId == userId).Select(c => c.Id).ToListAsync();
        foreach (var cid in conversations)
            await db.CoachMessages.Where(m => m.ConversationId == cid).ExecuteDeleteAsync();
        await db.Conversations.Where(c => c.UserId == userId).ExecuteDeleteAsync();
        await db.Analyses.Where(a => a.UserId == userId).ExecuteDeleteAsync();
        await db.AnalysisJobs.Where(j => j.UserId == userId).ExecuteDeleteAsync();
        await db.SongVersions.Where(v => db.Songs.Any(s => s.Id == v.SongId && s.UserId == userId)).ExecuteDeleteAsync();
        await db.Songs.Where(s => s.UserId == userId).ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
    }

    // (a) first call — 202 created, one coach_reply enqueue on `coach` with
    // three ids, a hidden user trigger row + pending assistant row, no
    // usage_event.
    [SkippableFact]
    public async Task First_Call_Creates_Rows_And_Enqueues_Coach_Reply_With_No_Usage_Event()
    {
        await TestDb.RequireAsync(factory);
        var (f, queue) = BuildWithFakeQueue();
        var (client, userId) = await RegisterRealUserAsync(f);
        var analysisId = await SeedAnalysisAsync(f, userId);

        try
        {
            var resp = await client.PostAsync($"/api/coach/{analysisId}/brief", null);
            Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);
            var body = await resp.Content.ReadFromJsonAsync<CoachBriefResponse>();
            Assert.Equal("created", body!.Status);
            Assert.NotNull(body.MessageId);

            Assert.Single(queue.Calls);
            var call = queue.Calls.Single();
            Assert.Equal(DramatiqTasks.CoachReply, call.Task);
            Assert.Equal(DramatiqQueues.Coach, call.Queue);
            Assert.Equal(3, call.Args.Length);

            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var conv = await db.Conversations.SingleAsync(c => c.UserId == userId);
            var rows = await db.CoachMessages.Where(m => m.ConversationId == conv.Id).ToListAsync();
            Assert.Equal(2, rows.Count);
            Assert.Contains(rows, m => m.Role == "user" && m.Mode == "brief" && m.Content == CoachBrief.Instruction);
            Assert.Contains(rows, m => m.Role == "assistant" && m.Mode == "brief" && m.Status == "pending");

            var usageEvents = await db.UsageEvents.CountAsync(e => e.UserId == userId && e.EventType == "coach_message");
            Assert.Equal(0, usageEvents);
        }
        finally { await CleanupUser(f, userId); }
    }

    // (b) second call — 200 exists, same messageId, nothing enqueued.
    [SkippableFact]
    public async Task Second_Call_Returns_Exists_With_Same_MessageId_And_Enqueues_Nothing()
    {
        await TestDb.RequireAsync(factory);
        var (f, queue) = BuildWithFakeQueue();
        var (client, userId) = await RegisterRealUserAsync(f);
        var analysisId = await SeedAnalysisAsync(f, userId);

        try
        {
            var first = await (await client.PostAsync($"/api/coach/{analysisId}/brief", null))
                .Content.ReadFromJsonAsync<CoachBriefResponse>();
            var secondResp = await client.PostAsync($"/api/coach/{analysisId}/brief", null);
            Assert.Equal(HttpStatusCode.OK, secondResp.StatusCode);
            var second = await secondResp.Content.ReadFromJsonAsync<CoachBriefResponse>();

            Assert.Equal("exists", second!.Status);
            Assert.Equal(first!.MessageId, second.MessageId);
            Assert.Single(queue.Calls);
        }
        finally { await CleanupUser(f, userId); }
    }

    // (c) two parallel calls — exactly one assistant brief row (the
    // partial-unique-index test).
    [SkippableFact]
    public async Task Concurrent_Calls_Converge_On_Exactly_One_Assistant_Brief_Row()
    {
        await TestDb.RequireAsync(factory);
        var (f, queue) = BuildWithFakeQueue();
        var (client, userId) = await RegisterRealUserAsync(f);
        var analysisId = await SeedAnalysisAsync(f, userId);

        try
        {
            var t1 = client.PostAsync($"/api/coach/{analysisId}/brief", null);
            var t2 = client.PostAsync($"/api/coach/{analysisId}/brief", null);
            var t3 = client.PostAsync($"/api/coach/{analysisId}/brief", null);
            await Task.WhenAll(t1, t2, t3);

            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var conv = await db.Conversations.SingleAsync(c => c.UserId == userId);
            var briefAssistantCount = await db.CoachMessages.CountAsync(
                m => m.ConversationId == conv.Id && m.Role == "assistant" && m.Mode == "brief");
            Assert.Equal(1, briefAssistantCount);
        }
        finally { await CleanupUser(f, userId); }
    }

    // (d) routing_plan == null → 409 brief_not_ready.
    [SkippableFact]
    public async Task No_Routing_Plan_Returns_409_Brief_Not_Ready()
    {
        await TestDb.RequireAsync(factory);
        var (f, _) = BuildWithFakeQueue();
        var (client, userId) = await RegisterRealUserAsync(f);
        var analysisId = await SeedAnalysisAsync(f, userId, routingPlan: null);

        try
        {
            var resp = await client.PostAsync($"/api/coach/{analysisId}/brief", null);
            Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
            var json = await resp.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
            Assert.Equal("brief_not_ready", json.GetProperty("error").GetProperty("code").GetString());
        }
        finally { await CleanupUser(f, userId); }
    }

    // (e) a demo version → 200 skipped, nothing enqueued, nothing inserted.
    [SkippableFact]
    public async Task Demo_Version_Returns_Skipped_And_Writes_Nothing()
    {
        await TestDb.RequireAsync(factory);
        var (f, queue) = BuildWithFakeQueue();
        var (client, userId) = await RegisterRealUserAsync(f);
        var analysisId = await SeedAnalysisAsync(f, userId, demoVersion: true);

        try
        {
            var resp = await client.PostAsync($"/api/coach/{analysisId}/brief", null);
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            var body = await resp.Content.ReadFromJsonAsync<CoachBriefResponse>();
            Assert.Equal("skipped", body!.Status);
            Assert.Null(body.MessageId);
            Assert.Empty(queue.Calls);

            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Equal(0, await db.Conversations.CountAsync(c => c.UserId == userId));
        }
        finally { await CleanupUser(f, userId); }
    }

    // (f) GET conversation never returns the hidden row; brief carries
    // IsBrief=true and ClosingLine set for guests, null for real users.
    [SkippableFact]
    public async Task Get_Conversation_Hides_Trigger_Row_And_Sets_ClosingLine_For_Guests_Only()
    {
        await TestDb.RequireAsync(factory);
        var (f, _) = BuildWithFakeQueue();
        var (client, userId) = await RegisterRealUserAsync(f);
        var analysisId = await SeedAnalysisAsync(f, userId);

        try
        {
            var created = await (await client.PostAsync($"/api/coach/{analysisId}/brief", null))
                .Content.ReadFromJsonAsync<CoachBriefResponse>();

            // Simulate the worker completing the brief.
            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var row = await db.CoachMessages.SingleAsync(m => m.Id == created!.MessageId);
                row.Status = "complete";
                row.Content = "Here's your opening brief.";
                await db.SaveChangesAsync();
            }

            var conv = await client.GetFromJsonAsync<CoachConversationDto>($"/api/coach/{analysisId}/conversation");
            Assert.NotNull(conv);
            Assert.DoesNotContain(conv!.Messages, m => m.Content == CoachBrief.Instruction);
            var brief = Assert.Single(conv.Messages, m => m.IsBrief);
            Assert.Null(brief.ClosingLine); // real (non-guest) user

            // Guest caller sees the closing line on the same completed brief.
            var (guestClient, guestId) = await StartGuestAsync(f);
            var guestAnalysisId = await SeedAnalysisAsync(f, guestId);
            var guestCreated = await (await guestClient.PostAsync($"/api/coach/{guestAnalysisId}/brief", null))
                .Content.ReadFromJsonAsync<CoachBriefResponse>();
            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var row = await db.CoachMessages.SingleAsync(m => m.Id == guestCreated!.MessageId);
                row.Status = "complete";
                row.Content = "Here's your opening brief.";
                await db.SaveChangesAsync();
            }
            var guestConv = await guestClient.GetFromJsonAsync<CoachConversationDto>($"/api/coach/{guestAnalysisId}/conversation");
            var guestBrief = Assert.Single(guestConv!.Messages, m => m.IsBrief);
            Assert.Equal(CoachBrief.GuestClosingLine, guestBrief.ClosingLine);
            await CleanupUser(f, guestId);
        }
        finally { await CleanupUser(f, userId); }
    }

    // (g) a guest with coach_guest_messages already spent can still get a
    // brief; a brief never moves GET /api/me/guest's coachMessagesUsed.
    [SkippableFact]
    public async Task Guest_With_Cap_Spent_Can_Still_Get_A_Brief_And_It_Does_Not_Move_Guest_State()
    {
        await TestDb.RequireAsync(factory);
        var (f, queue) = BuildWithFakeQueue();
        var (client, userId) = await StartGuestAsync(f);
        var analysisId = await SeedAnalysisAsync(f, userId);

        try
        {
            var before = await client.GetFromJsonAsync<GuestStateDto>("/api/me/guest");

            // Spend the guest's entire coach_guest_messages allowance via
            // usage_events directly (avoids needing a working coach_reply
            // actor in-test).
            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                for (var i = 0; i < before!.CoachMessagesMax; i++)
                {
                    db.UsageEvents.Add(new UsageEvent
                    {
                        UserId = userId, EventType = "coach_message",
                        BillingPeriod = DateTimeOffset.UtcNow.ToString("yyyy-MM"), Reference = Guid.NewGuid().ToString(),
                    });
                }
                await db.SaveChangesAsync();
            }

            var resp = await client.PostAsync($"/api/coach/{analysisId}/brief", null);
            Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);
            Assert.Single(queue.Calls);

            var after = await client.GetFromJsonAsync<GuestStateDto>("/api/me/guest");
            Assert.Equal(before.CoachMessagesMax, after!.CoachMessagesUsed);
        }
        finally { await CleanupUser(f, userId); }
    }

    // (h) another user's analysis → 404.
    [SkippableFact]
    public async Task Another_Users_Analysis_Returns_404()
    {
        await TestDb.RequireAsync(factory);
        var (f, _) = BuildWithFakeQueue();
        var (_, ownerId) = await RegisterRealUserAsync(f);
        var analysisId = await SeedAnalysisAsync(f, ownerId);
        var (otherClient, otherId) = await RegisterRealUserAsync(f);

        try
        {
            var resp = await otherClient.PostAsync($"/api/coach/{analysisId}/brief", null);
            Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        }
        finally
        {
            await CleanupUser(f, otherId);
            await CleanupUser(f, ownerId);
        }
    }
}
