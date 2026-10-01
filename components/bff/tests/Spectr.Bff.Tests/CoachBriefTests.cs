using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.DTOs;
using Spectr.Bff.Endpoints;
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
    internal sealed class RecordingJobQueue : IJobQueue
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
    // Fix round 1 item 1: `degradationNotice` reproduces a TERMINALLY
    // degraded triage — routing_plan stays null forever but the analysis
    // is still "ready" (that's exactly the case the template-fallback
    // brief exists for).
    internal static async Task<Guid> SeedAnalysisAsync(
        WebApplicationFactory<Program> f, Guid userId,
        string? routingPlan = "not-null", bool demoVersion = false,
        string? degradationNotice = null)
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
            DegradationNotice = degradationNotice,
        };
        db.Analyses.Add(analysis);
        await db.SaveChangesAsync();
        return analysis.Id;
    }

    internal static async Task<(HttpClient Client, Guid UserId)> RegisterRealUserAsync(WebApplicationFactory<Program> f)
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

    internal static async Task CleanupUser(WebApplicationFactory<Program> factory, Guid userId)
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
            // Fix round 1 item 3a: the row-count assertion alone doesn't
            // prove only one coach_reply was dispatched — assert the
            // enqueue count too.
            Assert.Single(queue.Calls);
        }
        finally { await CleanupUser(f, userId); }
    }

    // Fix round 1 item 1 (CRITICAL): a triage-degraded analysis — routing_plan
    // stays permanently null, degradation_notice is set — must NOT 409
    // forever. It is exactly the case the template-fallback brief
    // (coach_actor.py _complete_with_template_brief) was built for.
    [SkippableFact]
    public async Task Degraded_Analysis_With_No_Routing_Plan_Returns_202_Created()
    {
        await TestDb.RequireAsync(factory);
        var (f, queue) = BuildWithFakeQueue();
        var (client, userId) = await RegisterRealUserAsync(f);
        var analysisId = await SeedAnalysisAsync(
            f, userId, routingPlan: null,
            degradationNotice: "{\"reason\":\"tier_budget\",\"detail\":\"spent=$5.00 ceiling=$5.00\"}");

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
            Assert.Equal(3, call.Args.Length);
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

    // ── Fix round 1 item 2 (IMPORTANT): a broken brief must not stick
    // forever. `FindExistingBriefAsync` used to match role=assistant &&
    // mode=brief regardless of status, so an `error` row (enqueue failed
    // after commit) or a stuck `pending`/`streaming` row (worker lost the
    // message) answered `exists` forever with nothing ever re-enqueued.

    // error row → retried + one (more) enqueue.
    [SkippableFact]
    public async Task Error_Brief_Retries_And_Enqueues_Once_More()
    {
        await TestDb.RequireAsync(factory);
        var (f, queue) = BuildWithFakeQueue();
        var (client, userId) = await RegisterRealUserAsync(f);
        var analysisId = await SeedAnalysisAsync(f, userId);

        try
        {
            var first = await (await client.PostAsync($"/api/coach/{analysisId}/brief", null))
                .Content.ReadFromJsonAsync<CoachBriefResponse>();
            Assert.Single(queue.Calls);

            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var row = await db.CoachMessages.SingleAsync(m => m.Id == first!.MessageId);
                row.Status = "error";
                row.Content = "The coach hit a transient error. Please try again.";
                row.CompletedAt = DateTimeOffset.UtcNow;
                await db.SaveChangesAsync();
            }

            var resp = await client.PostAsync($"/api/coach/{analysisId}/brief", null);
            Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);
            var body = await resp.Content.ReadFromJsonAsync<CoachBriefResponse>();
            Assert.Equal("retried", body!.Status);
            Assert.Equal(first!.MessageId, body.MessageId); // same row, not a new one
            Assert.Equal(2, queue.Calls.Count);

            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var row = await db.CoachMessages.SingleAsync(m => m.Id == first.MessageId);
                Assert.Equal("pending", row.Status);
            }
        }
        finally { await CleanupUser(f, userId); }
    }

    // stale pending (older than the staleness window — 11 minutes at the
    // current 600s window; derived from the constant, not a literal, so
    // this stays correct if the window value changes again) → retried.
    [SkippableFact]
    public async Task Stale_Pending_Brief_Retries()
    {
        await TestDb.RequireAsync(factory);
        var (f, queue) = BuildWithFakeQueue();
        var (client, userId) = await RegisterRealUserAsync(f);
        var analysisId = await SeedAnalysisAsync(f, userId);

        try
        {
            var first = await (await client.PostAsync($"/api/coach/{analysisId}/brief", null))
                .Content.ReadFromJsonAsync<CoachBriefResponse>();

            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var row = await db.CoachMessages.SingleAsync(m => m.Id == first!.MessageId);
                Assert.Equal("pending", row.Status); // still pending — never got a worker
                row.CreatedAt = DateTimeOffset.UtcNow
                    .AddSeconds(-(CoachBriefEndpoints.StalenessWindowSeconds + 60));
                await db.SaveChangesAsync();
            }

            var resp = await client.PostAsync($"/api/coach/{analysisId}/brief", null);
            Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);
            var body = await resp.Content.ReadFromJsonAsync<CoachBriefResponse>();
            Assert.Equal("retried", body!.Status);
            Assert.Equal(2, queue.Calls.Count);
        }
        finally { await CleanupUser(f, userId); }
    }

    // A pending brief 3 minutes (180s) old: past the OLD 120s staleness
    // window (would have been incorrectly `retried` before fix round 2
    // item 2) but comfortably inside the NEW 600s window → stays `exists`,
    // no enqueue. Deliberately a literal, not the constant — this test
    // exists to pin the window's ABSOLUTE size, not move with it.
    [SkippableFact]
    public async Task Pending_Brief_Three_Minutes_Old_Stays_Exists_With_No_Extra_Enqueue()
    {
        await TestDb.RequireAsync(factory);
        var (f, queue) = BuildWithFakeQueue();
        var (client, userId) = await RegisterRealUserAsync(f);
        var analysisId = await SeedAnalysisAsync(f, userId);

        try
        {
            var first = await (await client.PostAsync($"/api/coach/{analysisId}/brief", null))
                .Content.ReadFromJsonAsync<CoachBriefResponse>();

            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var row = await db.CoachMessages.SingleAsync(m => m.Id == first!.MessageId);
                row.CreatedAt = DateTimeOffset.UtcNow.AddMinutes(-3);
                await db.SaveChangesAsync();
            }

            var resp = await client.PostAsync($"/api/coach/{analysisId}/brief", null);
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            var body = await resp.Content.ReadFromJsonAsync<CoachBriefResponse>();
            Assert.Equal("exists", body!.Status);
            Assert.Equal(first!.MessageId, body.MessageId);
            Assert.Single(queue.Calls); // only the original create — no retry enqueue
        }
        finally { await CleanupUser(f, userId); }
    }

    // fresh pending (younger than the window) → exists, no enqueue.
    [SkippableFact]
    public async Task Fresh_Pending_Brief_Stays_Exists_With_No_Extra_Enqueue()
    {
        await TestDb.RequireAsync(factory);
        var (f, queue) = BuildWithFakeQueue();
        var (client, userId) = await RegisterRealUserAsync(f);
        var analysisId = await SeedAnalysisAsync(f, userId);

        try
        {
            var first = await (await client.PostAsync($"/api/coach/{analysisId}/brief", null))
                .Content.ReadFromJsonAsync<CoachBriefResponse>();

            var resp = await client.PostAsync($"/api/coach/{analysisId}/brief", null);
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            var body = await resp.Content.ReadFromJsonAsync<CoachBriefResponse>();
            Assert.Equal("exists", body!.Status);
            Assert.Equal(first!.MessageId, body.MessageId);
            Assert.Single(queue.Calls); // only the original create — no retry enqueue
        }
        finally { await CleanupUser(f, userId); }
    }

    // complete row → exists, no enqueue.
    [SkippableFact]
    public async Task Complete_Brief_Stays_Exists_With_No_Extra_Enqueue()
    {
        await TestDb.RequireAsync(factory);
        var (f, queue) = BuildWithFakeQueue();
        var (client, userId) = await RegisterRealUserAsync(f);
        var analysisId = await SeedAnalysisAsync(f, userId);

        try
        {
            var first = await (await client.PostAsync($"/api/coach/{analysisId}/brief", null))
                .Content.ReadFromJsonAsync<CoachBriefResponse>();

            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var row = await db.CoachMessages.SingleAsync(m => m.Id == first!.MessageId);
                row.Status = "complete";
                row.Content = "Here's your opening brief.";
                row.CompletedAt = DateTimeOffset.UtcNow;
                await db.SaveChangesAsync();
            }

            var resp = await client.PostAsync($"/api/coach/{analysisId}/brief", null);
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            var body = await resp.Content.ReadFromJsonAsync<CoachBriefResponse>();
            Assert.Equal("exists", body!.Status);
            Assert.Equal(first!.MessageId, body.MessageId);
            Assert.Single(queue.Calls);
        }
        finally { await CleanupUser(f, userId); }
    }

    // Two parallel retries against the same broken (error) row must produce
    // exactly ONE more enqueue — the conditional ExecuteUpdateAsync reset is
    // the race guard (only the caller whose UPDATE affects exactly 1 row
    // gets to enqueue).
    [SkippableFact]
    public async Task Two_Parallel_Retries_Enqueue_Exactly_Once()
    {
        await TestDb.RequireAsync(factory);
        var (f, queue) = BuildWithFakeQueue();
        var (client, userId) = await RegisterRealUserAsync(f);
        var analysisId = await SeedAnalysisAsync(f, userId);

        try
        {
            var first = await (await client.PostAsync($"/api/coach/{analysisId}/brief", null))
                .Content.ReadFromJsonAsync<CoachBriefResponse>();

            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var row = await db.CoachMessages.SingleAsync(m => m.Id == first!.MessageId);
                row.Status = "error";
                row.Content = "The coach hit a transient error. Please try again.";
                row.CompletedAt = DateTimeOffset.UtcNow;
                await db.SaveChangesAsync();
            }

            var t1 = client.PostAsync($"/api/coach/{analysisId}/brief", null);
            var t2 = client.PostAsync($"/api/coach/{analysisId}/brief", null);
            await Task.WhenAll(t1, t2);

            // 1 (original create) + exactly 1 (the winning retry).
            Assert.Equal(2, queue.Calls.Count);
        }
        finally { await CleanupUser(f, userId); }
    }

    // Fix round 2 item 1: two (well, three counting the seeded row) PARALLEL
    // retries against an already-STALE `pending` row must produce exactly
    // ONE more enqueue. Before the fix, the reset's SET clause never
    // advanced CreatedAt, so the staleness predicate stayed true for every
    // racer even after the first one won — this reproduces deterministically
    // (not just under true thread interleaving) because the bug is a logic
    // bug in the WHERE predicate, not a timing window: even two SEQUENTIAL
    // retries against a stale-pending row double-enqueue on the buggy code,
    // so Task.WhenAll here is exercising the real concurrent path but isn't
    // needed to make the assertion fail reliably. Also asserts the winning
    // reset refreshed CreatedAt to "now" — that's what stops a THIRD retry
    // from re-tripping the same stale window immediately after.
    [SkippableFact]
    public async Task Two_Parallel_Retries_On_Stale_Pending_Enqueue_Exactly_Once()
    {
        await TestDb.RequireAsync(factory);
        var (f, queue) = BuildWithFakeQueue();
        var (client, userId) = await RegisterRealUserAsync(f);
        var analysisId = await SeedAnalysisAsync(f, userId);

        try
        {
            var first = await (await client.PostAsync($"/api/coach/{analysisId}/brief", null))
                .Content.ReadFromJsonAsync<CoachBriefResponse>();

            var staleAt = DateTimeOffset.UtcNow
                .AddSeconds(-(CoachBriefEndpoints.StalenessWindowSeconds + 60));
            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var row = await db.CoachMessages.SingleAsync(m => m.Id == first!.MessageId);
                Assert.Equal("pending", row.Status); // still pending — never got a worker
                row.CreatedAt = staleAt;
                await db.SaveChangesAsync();
            }

            var beforeRetries = DateTimeOffset.UtcNow;
            var t1 = client.PostAsync($"/api/coach/{analysisId}/brief", null);
            var t2 = client.PostAsync($"/api/coach/{analysisId}/brief", null);
            await Task.WhenAll(t1, t2);

            // 1 (original create) + exactly 1 (the winning retry) — never 2.
            Assert.Equal(2, queue.Calls.Count);

            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var row = await db.CoachMessages.SingleAsync(m => m.Id == first!.MessageId);
                Assert.Equal("pending", row.Status);
                // The winning reset must have refreshed CreatedAt off the
                // stale timestamp — otherwise a third retry would re-trip
                // the same stale window immediately.
                Assert.True(row.CreatedAt >= beforeRetries.AddSeconds(-1));
            }
        }
        finally { await CleanupUser(f, userId); }
    }

    // Fix round 2 item 1 (aged error variant): an `error` brief 11 minutes
    // old (well past the staleness window), retried twice in parallel, must
    // still enqueue exactly once. The error branch's race guard doesn't
    // depend on CreatedAt directly (status flips away from 'error' on the
    // winning reset, which alone stops a loser's WHERE from matching) — but
    // before this fix an aged error row became, after the winning reset, a
    // stale `pending` row with an untouched old CreatedAt, which re-opened
    // exactly the same hole as the plain stale-pending case above. This
    // confirms the added CreatedAt refresh keeps the aged-error path safe
    // too.
    [SkippableFact]
    public async Task Stale_Error_Brief_Two_Parallel_Retries_Enqueue_Exactly_Once()
    {
        await TestDb.RequireAsync(factory);
        var (f, queue) = BuildWithFakeQueue();
        var (client, userId) = await RegisterRealUserAsync(f);
        var analysisId = await SeedAnalysisAsync(f, userId);

        try
        {
            var first = await (await client.PostAsync($"/api/coach/{analysisId}/brief", null))
                .Content.ReadFromJsonAsync<CoachBriefResponse>();

            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var row = await db.CoachMessages.SingleAsync(m => m.Id == first!.MessageId);
                row.Status = "error";
                row.Content = "The coach hit a transient error. Please try again.";
                row.CompletedAt = DateTimeOffset.UtcNow;
                row.CreatedAt = DateTimeOffset.UtcNow
                    .AddSeconds(-(CoachBriefEndpoints.StalenessWindowSeconds + 60));
                await db.SaveChangesAsync();
            }

            var t1 = client.PostAsync($"/api/coach/{analysisId}/brief", null);
            var t2 = client.PostAsync($"/api/coach/{analysisId}/brief", null);
            await Task.WhenAll(t1, t2);

            Assert.Equal(2, queue.Calls.Count);
        }
        finally { await CleanupUser(f, userId); }
    }
}
