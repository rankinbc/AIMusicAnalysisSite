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
        // Story 12.6: ConcurrentQueue — Concurrent_Posts_Converge fires 3
        // parallel POSTs; a plain List<> tore/lost adds and flaked the count.
        public readonly System.Collections.Concurrent.ConcurrentQueue<(string Task, object[] Args, string Queue)> Calls = new();

        public Task EnqueueAsync(string taskName, object[] args, CancellationToken ct = default)
            => EnqueueAsync(taskName, args, DramatiqQueues.Default, ct);

        public Task EnqueueAsync(string taskName, object[] args, string queueName, CancellationToken ct = default)
        {
            // Story 4.3: registration enqueues a verification send_email on
            // this interface — irrelevant to coach-dispatch assertions.
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
        WebApplicationFactory<Program> factory, string emailPrefix, string? degradationNotice = null,
        bool fund = true)
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
        // Credits on ⇒ a real user is tier "credits" and each coach message is
        // charged (spec 3.3) — fund the happy-path users.
        if (fund) await TestCredits.GrantAsync(factory, userId);
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
            var call = queue.Calls.Single();
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

    // ── Spec 3.3: no free per-analysis cap for real users under credits ─────

    [SkippableFact]
    public async Task Post_ZeroBalance_Returns_402_InsufficientCredits_And_Does_Not_Enqueue()
    {
        // The legacy free follow-up allotment (3 per analysis, then 403
        // coach_cap_reached) no longer applies: a 0-balance real user is tier
        // "credits" and gets the buy-sheet 402. Zero side-effects on refusal.
        await TestDb.RequireAsync(_factory);

        var (factory, queue) = BuildWithFakeQueue();
        var (client, userId, analysisId) = await SeedAuthedUserAndAnalysis(factory, "coach-zero", fund: false);

        try
        {
            var refused = await client.PostAsJsonAsync(
                $"/api/coach/{analysisId}/messages",
                new CreateCoachMessageRequest("Q1"));
            Assert.Equal(HttpStatusCode.PaymentRequired, refused.StatusCode);
            using (var doc = JsonDocument.Parse(await refused.Content.ReadAsStringAsync()))
                Assert.Equal("insufficient_credits",
                    doc.RootElement.GetProperty("error").GetProperty("code").GetString());

            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.False(await db.Conversations.AnyAsync(c => c.UserId == userId));
            Assert.Empty(queue.Calls);
        }
        finally
        {
            await CleanupUser(factory, userId);
        }
    }

    [SkippableFact]
    public async Task Get_Conversation_Caps_Are_Unlimited_For_Credits_Tier()
    {
        // AC2 + AC4: the GET DTO surfaces caps so the frontend can render the
        // gate state on first paint. Credits tier ⇒ unlimited scope, never reached.
        await TestDb.RequireAsync(_factory);

        var (factory, _) = BuildWithFakeQueue();
        var (client, userId, analysisId) = await SeedAuthedUserAndAnalysis(factory, "coach-getcaps");

        try
        {
            var empty = await client.GetAsync($"/api/coach/{analysisId}/conversation");
            var emptyBody = await empty.Content.ReadFromJsonAsync<CoachConversationDto>();
            Assert.NotNull(emptyBody);
            Assert.Equal(0, emptyBody!.Caps.Used);
            Assert.Equal("unlimited", emptyBody.Caps.Scope);
            Assert.False(emptyBody.Caps.CapReached);

            await client.PostAsJsonAsync(
                $"/api/coach/{analysisId}/messages",
                new CreateCoachMessageRequest("Q1"));

            var hydrated = await client.GetAsync($"/api/coach/{analysisId}/conversation");
            var hydratedBody = await hydrated.Content.ReadFromJsonAsync<CoachConversationDto>();
            Assert.Equal("unlimited", hydratedBody!.Caps.Scope);
            Assert.False(hydratedBody.Caps.CapReached);
        }
        finally
        {
            await CleanupUser(factory, userId);
        }
    }

    // ── adhoc-concise: Concise is a real third wire mode ─────────────────────

    [SkippableFact]
    public async Task Post_Message_With_Concise_Mode_Persists_And_Returns_Concise()
    {
        // (a) mode:"concise" must survive the round trip: both the user row
        // and the pending assistant row persist mode="concise", and the GET
        // conversation view reports "concise" for both. Pre-fix this fails
        // two ways: the endpoint coerces anything but "teach" to "qa", and
        // (before the migration) the DB CHECK constraint would reject the
        // value outright.
        await TestDb.RequireAsync(_factory);

        var (factory, _) = BuildWithFakeQueue();
        var (client, userId, analysisId) = await SeedAuthedUserAndAnalysis(factory, "coach-concise");

        try
        {
            var resp = await client.PostAsJsonAsync(
                $"/api/coach/{analysisId}/messages",
                new CreateCoachMessageRequest("Give me the one thing to fix", "concise"));
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var conv = await db.Conversations.SingleAsync(c => c.UserId == userId);
                var msgs = await db.CoachMessages.Where(m => m.ConversationId == conv.Id).ToListAsync();
                Assert.Equal(2, msgs.Count);
                Assert.All(msgs, m => Assert.Equal("concise", m.Mode));
            }

            var getResp = await client.GetAsync($"/api/coach/{analysisId}/conversation");
            Assert.Equal(HttpStatusCode.OK, getResp.StatusCode);
            var body = await getResp.Content.ReadFromJsonAsync<CoachConversationDto>();
            Assert.NotNull(body);
            Assert.Equal(2, body!.Messages.Count);
            Assert.All(body.Messages, m => Assert.Equal("concise", m.Mode));
        }
        finally
        {
            await CleanupUser(factory, userId);
        }
    }

    [SkippableFact]
    public async Task Post_Message_With_Unknown_Mode_Coerces_To_Qa()
    {
        // (b) an unrecognized mode string still coerces to "qa" — only
        // "teach" and "concise" are honored.
        await TestDb.RequireAsync(_factory);

        var (factory, _) = BuildWithFakeQueue();
        var (client, userId, analysisId) = await SeedAuthedUserAndAnalysis(factory, "coach-loudmode");

        try
        {
            var resp = await client.PostAsJsonAsync(
                $"/api/coach/{analysisId}/messages",
                new CreateCoachMessageRequest("anything", "loud"));
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var conv = await db.Conversations.SingleAsync(c => c.UserId == userId);
            var msgs = await db.CoachMessages.Where(m => m.ConversationId == conv.Id).ToListAsync();
            Assert.Equal(2, msgs.Count);
            Assert.All(msgs, m => Assert.Equal("qa", m.Mode));
        }
        finally
        {
            await CleanupUser(factory, userId);
        }
    }

    [SkippableFact]
    public async Task Post_Message_With_Omitted_Mode_Defaults_To_Qa()
    {
        // (c) an omitted mode field keeps every existing caller working.
        await TestDb.RequireAsync(_factory);

        var (factory, _) = BuildWithFakeQueue();
        var (client, userId, analysisId) = await SeedAuthedUserAndAnalysis(factory, "coach-omitmode");

        try
        {
            var resp = await client.PostAsJsonAsync(
                $"/api/coach/{analysisId}/messages",
                new CreateCoachMessageRequest("anything"));
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var conv = await db.Conversations.SingleAsync(c => c.UserId == userId);
            var msgs = await db.CoachMessages.Where(m => m.ConversationId == conv.Id).ToListAsync();
            Assert.Equal(2, msgs.Count);
            Assert.All(msgs, m => Assert.Equal("qa", m.Mode));
        }
        finally
        {
            await CleanupUser(factory, userId);
        }
    }
}
