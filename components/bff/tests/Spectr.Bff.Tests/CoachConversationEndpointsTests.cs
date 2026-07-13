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
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 1.5: integration tests for the persisted-coach surface.
//   POST /api/coach/{analysisId}/messages → persists user + pending assistant
//                                            rows and enqueues coach_reply
//                                            on the `coach` queue.
//   GET  /api/coach/{analysisId}/conversation → polling view.
//
// Skips silently when Postgres isn't reachable (mirrors
// VerdictsEndpointDegradationTests + AuthEndpointsTests).
public sealed class CoachConversationEndpointsTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    // Recording fake — captures every enqueue so tests can assert against
    // task name + args + queue without standing up a real Redis.
    private sealed class RecordingJobQueue : IJobQueue
    {
        public readonly List<(string Task, object[] Args, string Queue)> Calls = new();

        public Task EnqueueAsync(string taskName, object[] args, CancellationToken ct = default)
            => EnqueueAsync(taskName, args, DramatiqQueues.Default, ct);

        public Task EnqueueAsync(string taskName, object[] args, string queueName, CancellationToken ct = default)
        {
            // Story 4.3: registration enqueues a verification send_email on
            // this interface — irrelevant to coach-dispatch assertions.
            if (taskName != DramatiqTasks.SendEmail)
                Calls.Add((taskName, args, queueName));
            return Task.CompletedTask;
        }

        public Task EnqueueDelayedAsync(string taskName, object[] args, string queueName, TimeSpan delay, CancellationToken ct = default)
        {
            if (taskName != DramatiqTasks.SendEmail)
                Calls.Add((taskName, args, queueName));
            return Task.CompletedTask;
        }
    }

    private (WebApplicationFactory<Program> Factory, RecordingJobQueue Queue) BuildWithFakeQueue()
    {
        var queue = new RecordingJobQueue();
        var f = _factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll(typeof(IJobQueue));
                services.AddSingleton<IJobQueue>(queue);
            });
        });
        return (f, queue);
    }


    private static AnalysisJob NewJob(Guid userId) => new()
    {
        Id = Guid.NewGuid(),
        UserId = userId,
        Status = "complete",
        DispatchedAt = DateTimeOffset.UtcNow,
        CompletedAt = DateTimeOffset.UtcNow,
    };

    private static Analysis NewAnalysis(Guid jobId, Guid userId, string? degradationNotice = null) => new()
    {
        Id = Guid.NewGuid(),
        JobId = jobId,
        UserId = userId,
        FinalJson = "{}",
        PhaseDurations = "{}",
        DegradationNotice = degradationNotice,
        CreatedAt = DateTimeOffset.UtcNow,
    };

    private static async Task<(HttpClient Client, Guid UserId, Guid AnalysisId)> SeedAuthedUserAndAnalysis(
        WebApplicationFactory<Program> factory, string emailPrefix, string? degradationNotice = null)
    {
        var client = factory.CreateClient();
        var email = $"{emailPrefix}+{Guid.NewGuid():N}@spectr.test";
        var password = "correct-horse-battery";
        var reg = await client.PostAsJsonAsync("/api/auth/register", new { email, password });
        Assert.Equal(HttpStatusCode.OK, reg.StatusCode);
        var auth = await reg.Content.ReadFromJsonAsync<AuthResponse>();
        Assert.NotNull(auth);
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", auth!.AccessToken);

        Guid userId, analysisId;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            userId = user.Id;
            var job = NewJob(userId);
            db.AnalysisJobs.Add(job);
            var analysis = NewAnalysis(job.Id, userId, degradationNotice);
            db.Analyses.Add(analysis);
            await db.SaveChangesAsync();
            analysisId = analysis.Id;
        }
        return (client, userId, analysisId);
    }

    private static async Task CleanupUser(WebApplicationFactory<Program> factory, Guid userId)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        // CoachMessages cascade-clean via the conversation FK CASCADE if we
        // had one; the project convention is no DB-level FK, so we
        // explicitly clear everything we created.
        var conversations = await db.Conversations.Where(c => c.UserId == userId).Select(c => c.Id).ToListAsync();
        foreach (var cid in conversations)
            await db.CoachMessages.Where(m => m.ConversationId == cid).ExecuteDeleteAsync();
        await db.Conversations.Where(c => c.UserId == userId).ExecuteDeleteAsync();
        await db.AnalysisJobs.Where(j => j.UserId == userId).ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
    }

    [SkippableFact]
    public async Task Post_Message_Persists_Rows_And_Enqueues_Coach_Reply_On_Coach_Queue()
    {
        await TestDb.RequireAsync(_factory);

        var (factory, queue) = BuildWithFakeQueue();
        var (client, userId, analysisId) = await SeedAuthedUserAndAnalysis(factory, "coach-post");

        try
        {
            var resp = await client.PostAsJsonAsync(
                $"/api/coach/{analysisId}/messages",
                new CreateCoachMessageRequest("Why is my LUFS so low?"));
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            var body = await resp.Content.ReadFromJsonAsync<CreateCoachMessageResponse>();
            Assert.NotNull(body);
            Assert.NotEqual(Guid.Empty, body!.ConversationId);
            Assert.NotEqual(Guid.Empty, body.UserMessageId);
            Assert.NotEqual(Guid.Empty, body.PendingAssistantMessageId);

            // DB state: one conversation, two coach_messages.
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var convs = await db.Conversations.Where(c => c.UserId == userId).ToListAsync();
                Assert.Single(convs);
                var msgs = await db.CoachMessages.Where(m => m.ConversationId == convs[0].Id).ToListAsync();
                Assert.Equal(2, msgs.Count);
                Assert.Contains(msgs, m => m.Role == "user" && m.Status == "complete");
                Assert.Contains(msgs, m => m.Role == "assistant" && m.Status == "pending");
            }

            // Enqueue: exactly one, on the coach queue, with the right args.
            // Story 1.5 code review B-H2: wire format is now
            // (conversation_id, user_message_id, assistant_message_id) so
            // the actor doesn't have to infer the user-question from the tail.
            Assert.Single(queue.Calls);
            var call = queue.Calls[0];
            Assert.Equal(DramatiqTasks.CoachReply, call.Task);
            Assert.Equal(DramatiqQueues.Coach, call.Queue);
            Assert.Equal(3, call.Args.Length);
            Assert.Equal(body.ConversationId.ToString(), call.Args[0]);
            Assert.Equal(body.UserMessageId.ToString(), call.Args[1]);
            Assert.Equal(body.PendingAssistantMessageId.ToString(), call.Args[2]);
        }
        finally
        {
            await CleanupUser(factory, userId);
        }
    }

    [SkippableFact]
    public async Task Post_Second_Message_Reuses_Existing_Conversation()
    {
        await TestDb.RequireAsync(_factory);

        var (factory, queue) = BuildWithFakeQueue();
        var (client, userId, analysisId) = await SeedAuthedUserAndAnalysis(factory, "coach-reuse");

        try
        {
            var first = await (await client.PostAsJsonAsync(
                $"/api/coach/{analysisId}/messages",
                new CreateCoachMessageRequest("Q1"))).Content
                .ReadFromJsonAsync<CreateCoachMessageResponse>();
            var second = await (await client.PostAsJsonAsync(
                $"/api/coach/{analysisId}/messages",
                new CreateCoachMessageRequest("Q2"))).Content
                .ReadFromJsonAsync<CreateCoachMessageResponse>();

            Assert.NotNull(first);
            Assert.NotNull(second);
            Assert.Equal(first!.ConversationId, second!.ConversationId);

            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Equal(1, await db.Conversations.CountAsync(c => c.UserId == userId));
            Assert.Equal(4, await db.CoachMessages.CountAsync(
                m => m.ConversationId == first.ConversationId));
            Assert.Equal(2, queue.Calls.Count);
        }
        finally
        {
            await CleanupUser(factory, userId);
        }
    }

    [SkippableFact]
    public async Task Post_Empty_Content_Returns_400_With_AR38_Envelope()
    {
        await TestDb.RequireAsync(_factory);

        var (factory, _) = BuildWithFakeQueue();
        var (client, userId, analysisId) = await SeedAuthedUserAndAnalysis(factory, "coach-empty");

        try
        {
            var resp = await client.PostAsJsonAsync(
                $"/api/coach/{analysisId}/messages",
                new CreateCoachMessageRequest("   "));
            Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
            var body = await resp.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(body);
            var err = doc.RootElement.GetProperty("error");
            Assert.Equal("coach_message_invalid", err.GetProperty("code").GetString());
        }
        finally
        {
            await CleanupUser(factory, userId);
        }
    }

    [SkippableFact]
    public async Task Post_Against_Degraded_Analysis_Returns_503_Coach_Offline()
    {
        await TestDb.RequireAsync(_factory);

        const string offlineLine =
            "Coach is offline — your measured analysis and rule-based findings are unaffected.";
        var (factory, queue) = BuildWithFakeQueue();
        var (client, userId, analysisId) = await SeedAuthedUserAndAnalysis(
            factory, "coach-degr",
            degradationNotice: """
                {"reason":"tier_budget","detail":"tier=free spent=$5.00 ceiling=$5.00","occurred_at":"2026-06-15T12:00:00+00:00"}
                """);

        try
        {
            var resp = await client.PostAsJsonAsync(
                $"/api/coach/{analysisId}/messages",
                new CreateCoachMessageRequest("anything"));
            Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
            var body = await resp.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(body);
            var err = doc.RootElement.GetProperty("error");
            Assert.Equal("coach_offline", err.GetProperty("code").GetString());
            Assert.Equal(offlineLine, err.GetProperty("message").GetString());

            Assert.Empty(queue.Calls);
        }
        finally
        {
            await CleanupUser(factory, userId);
        }
    }

    [SkippableFact]
    public async Task Get_Conversation_Empty_Before_Any_Post()
    {
        await TestDb.RequireAsync(_factory);

        var (factory, _) = BuildWithFakeQueue();
        var (client, userId, analysisId) = await SeedAuthedUserAndAnalysis(factory, "coach-get-empty");

        try
        {
            var resp = await client.GetAsync($"/api/coach/{analysisId}/conversation");
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            var body = await resp.Content.ReadFromJsonAsync<CoachConversationDto>();
            Assert.NotNull(body);
            Assert.Equal(Guid.Empty, body!.ConversationId);
            Assert.Equal(analysisId, body.AnalysisId);
            Assert.Empty(body.Messages);
        }
        finally
        {
            await CleanupUser(factory, userId);
        }
    }

    [SkippableFact]
    public async Task Get_Conversation_Returns_Both_Messages_After_Post()
    {
        await TestDb.RequireAsync(_factory);

        var (factory, _) = BuildWithFakeQueue();
        var (client, userId, analysisId) = await SeedAuthedUserAndAnalysis(factory, "coach-get");

        try
        {
            await client.PostAsJsonAsync(
                $"/api/coach/{analysisId}/messages",
                new CreateCoachMessageRequest("Why am I getting a B?"));

            var resp = await client.GetAsync($"/api/coach/{analysisId}/conversation");
            var body = await resp.Content.ReadFromJsonAsync<CoachConversationDto>();
            Assert.NotNull(body);
            Assert.Equal(2, body!.Messages.Count);
            Assert.Equal("user", body.Messages[0].Role);
            Assert.Equal("complete", body.Messages[0].Status);
            Assert.Equal("assistant", body.Messages[1].Role);
            Assert.Equal("pending", body.Messages[1].Status);
        }
        finally
        {
            await CleanupUser(factory, userId);
        }
    }

    [SkippableFact]
    public async Task Cross_User_Isolation_Returns_404()
    {
        await TestDb.RequireAsync(_factory);

        var (factory, _) = BuildWithFakeQueue();
        var (clientA, userIdA, analysisIdA) = await SeedAuthedUserAndAnalysis(factory, "coach-A");
        var (clientB, userIdB, _) = await SeedAuthedUserAndAnalysis(factory, "coach-B");

        try
        {
            var resp = await clientB.GetAsync($"/api/coach/{analysisIdA}/conversation");
            Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);

            var postResp = await clientB.PostAsJsonAsync(
                $"/api/coach/{analysisIdA}/messages",
                new CreateCoachMessageRequest("steal"));
            Assert.Equal(HttpStatusCode.NotFound, postResp.StatusCode);
        }
        finally
        {
            await CleanupUser(factory, userIdA);
            await CleanupUser(factory, userIdB);
        }
    }

    [SkippableFact]
    public async Task Concurrent_Posts_Converge_On_Same_Conversation_No_500()
    {
        // Story 1.5 code review B-H1: pre-patch, two concurrent first-POSTs
        // both saw "no conversation", both Add'd, and the second
        // SaveChangesAsync blew up on the (analysis_id, user_id) unique
        // index with an unhandled DbUpdateException → 500. The
        // GetOrCreateConversationAsync helper now catches the
        // unique-violation and re-reads the winning row.
        await TestDb.RequireAsync(_factory);

        var (factory, queue) = BuildWithFakeQueue();
        var (client, userId, analysisId) = await SeedAuthedUserAndAnalysis(
            factory, "coach-race");

        try
        {
            // Three rapid concurrent POSTs against the same analysis.
            // Without the patch at least one would return 500; with the
            // patch all three succeed and converge on a single conversation.
            var tasks = new[]
            {
                client.PostAsJsonAsync($"/api/coach/{analysisId}/messages",
                    new CreateCoachMessageRequest("Q1")),
                client.PostAsJsonAsync($"/api/coach/{analysisId}/messages",
                    new CreateCoachMessageRequest("Q2")),
                client.PostAsJsonAsync($"/api/coach/{analysisId}/messages",
                    new CreateCoachMessageRequest("Q3")),
            };
            var responses = await Task.WhenAll(tasks);

            foreach (var r in responses)
            {
                Assert.Equal(HttpStatusCode.OK, r.StatusCode);
            }

            // Exactly one conversation row.
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var conversations = await db.Conversations
                .Where(c => c.UserId == userId)
                .ToListAsync();
            Assert.Single(conversations);

            // Six messages (3 user + 3 assistant), three enqueues.
            var msgs = await db.CoachMessages
                .Where(m => m.ConversationId == conversations[0].Id)
                .ToListAsync();
            Assert.Equal(6, msgs.Count);
            Assert.Equal(3, queue.Calls.Count);
        }
        finally
        {
            await CleanupUser(factory, userId);
        }
    }

    // ── Story 1.9: Per-Analysis Coach Caps (AC1-4) ───────────────────────────

    [SkippableFact]
    public async Task Post_AtCapLimit_Returns_403_CoachCapReached_And_Does_Not_Enqueue()
    {
        // AC1: server rejects further messages with `coach_cap_reached`.
        // AC4: source-of-truth is COUNT user messages on the conversation.
        // Regression guard: NO new coach_messages row, NO actor enqueue.
        await TestDb.RequireAsync(_factory);

        var (factory, queue) = BuildWithFakeQueue();
        var (client, userId, analysisId) = await SeedAuthedUserAndAnalysis(factory, "coach-cap");

        try
        {
            // Send three (the default FreeFollowups cap). Each one should
            // succeed and return an incrementing `used` field.
            for (var i = 1; i <= 3; i++)
            {
                var ok = await client.PostAsJsonAsync(
                    $"/api/coach/{analysisId}/messages",
                    new CreateCoachMessageRequest($"Q{i}"));
                Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
                var body = await ok.Content.ReadFromJsonAsync<CreateCoachMessageResponse>();
                Assert.NotNull(body);
                Assert.Equal(i, body!.Caps.Used);
                Assert.Equal(3, body.Caps.Limit);
                Assert.Equal(i == 3, body.Caps.CapReached);
            }

            // The fourth POST must refuse with coach_cap_reached.
            var refused = await client.PostAsJsonAsync(
                $"/api/coach/{analysisId}/messages",
                new CreateCoachMessageRequest("Q4 — over the line"));
            Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
            var refusedBody = await refused.Content.ReadAsStringAsync();
            using (var doc = JsonDocument.Parse(refusedBody))
            {
                var err = doc.RootElement.GetProperty("error");
                Assert.Equal("coach_cap_reached", err.GetProperty("code").GetString());
                var details = err.GetProperty("details");
                Assert.Equal(3, details.GetProperty("used").GetInt32());
                Assert.Equal(3, details.GetProperty("limit").GetInt32());
            }

            // Zero side-effects on refusal: still 3 user rows + 3 assistant
            // rows + 3 enqueues — nothing from the refused Q4.
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var conv = await db.Conversations.SingleAsync(c => c.UserId == userId);
            var userMsgs = await db.CoachMessages
                .CountAsync(m => m.ConversationId == conv.Id && m.Role == "user");
            Assert.Equal(3, userMsgs);
            Assert.Equal(3, queue.Calls.Count);
        }
        finally
        {
            await CleanupUser(factory, userId);
        }
    }

    [SkippableFact]
    public async Task Post_OneBelowLimit_Succeeds_And_Reports_CapReached_True()
    {
        // AC2 sanity case: at used = limit - 1 the POST goes through and the
        // returned caps shows CapReached = false (still room for one more);
        // the NEXT POST should flip CapReached = true in the response.
        await TestDb.RequireAsync(_factory);

        var (factory, _) = BuildWithFakeQueue();
        var (client, userId, analysisId) = await SeedAuthedUserAndAnalysis(factory, "coach-belowcap");

        try
        {
            var first = await client.PostAsJsonAsync(
                $"/api/coach/{analysisId}/messages",
                new CreateCoachMessageRequest("Q1"));
            Assert.Equal(HttpStatusCode.OK, first.StatusCode);
            var firstBody = await first.Content.ReadFromJsonAsync<CreateCoachMessageResponse>();
            Assert.Equal(1, firstBody!.Caps.Used);
            Assert.False(firstBody.Caps.CapReached);

            var second = await client.PostAsJsonAsync(
                $"/api/coach/{analysisId}/messages",
                new CreateCoachMessageRequest("Q2"));
            Assert.Equal(HttpStatusCode.OK, second.StatusCode);
            var secondBody = await second.Content.ReadFromJsonAsync<CreateCoachMessageResponse>();
            Assert.Equal(2, secondBody!.Caps.Used);
            Assert.False(secondBody.Caps.CapReached);  // 2 of 3, not yet capped.

            var third = await client.PostAsJsonAsync(
                $"/api/coach/{analysisId}/messages",
                new CreateCoachMessageRequest("Q3"));
            Assert.Equal(HttpStatusCode.OK, third.StatusCode);
            var thirdBody = await third.Content.ReadFromJsonAsync<CreateCoachMessageResponse>();
            Assert.Equal(3, thirdBody!.Caps.Used);
            Assert.True(thirdBody.Caps.CapReached);  // 3 of 3, capped.
        }
        finally
        {
            await CleanupUser(factory, userId);
        }
    }

    [SkippableFact]
    public async Task Get_Conversation_Includes_Caps_Field_Reflecting_User_Message_Count()
    {
        // AC2 + AC4: the GET DTO must surface caps so the frontend can render
        // the chip + gate state on first paint without a separate roundtrip.
        await TestDb.RequireAsync(_factory);

        var (factory, _) = BuildWithFakeQueue();
        var (client, userId, analysisId) = await SeedAuthedUserAndAnalysis(factory, "coach-getcaps");

        try
        {
            // Empty state: caps present, 0 of 3.
            var empty = await client.GetAsync($"/api/coach/{analysisId}/conversation");
            var emptyBody = await empty.Content.ReadFromJsonAsync<CoachConversationDto>();
            Assert.NotNull(emptyBody);
            Assert.Equal(0, emptyBody!.Caps.Used);
            Assert.Equal(3, emptyBody.Caps.Limit);
            Assert.False(emptyBody.Caps.CapReached);

            // After two POSTs: caps reflects 2 of 3.
            await client.PostAsJsonAsync(
                $"/api/coach/{analysisId}/messages",
                new CreateCoachMessageRequest("Q1"));
            await client.PostAsJsonAsync(
                $"/api/coach/{analysisId}/messages",
                new CreateCoachMessageRequest("Q2"));

            var hydrated = await client.GetAsync($"/api/coach/{analysisId}/conversation");
            var hydratedBody = await hydrated.Content.ReadFromJsonAsync<CoachConversationDto>();
            Assert.Equal(2, hydratedBody!.Caps.Used);
            Assert.Equal(3, hydratedBody.Caps.Limit);
            Assert.False(hydratedBody.Caps.CapReached);
        }
        finally
        {
            await CleanupUser(factory, userId);
        }
    }
}
