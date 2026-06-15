using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Data;
using Spectr.Data.Entities;
using StackExchange.Redis;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 1.6: SSE relay endpoint at GET /api/coach/{analysisId}/messages/{messageId}/stream.
//
// Deterministic cases (terminal-state short-circuit + ownership gate)
// run without Redis. The live-subscribe round-trip case is marked
// [Trait("Category","Slow")] so CI can filter it out in fast mode; it
// uses the real local Redis from the RedisReachable() gate, mirroring
// the PostgresReachable() pattern from VerdictsEndpointDegradationTests.
//
// AC4 (idle fallback after 30 s of pub/sub silence) + the 15 s
// heartbeat are covered by the local smoke test in story task 9.2 —
// adding a unit test for those would require either (a) waiting ≥30 s
// per run or (b) plumbing test-only overrides for the timers into the
// endpoint. Both add cost out of proportion to the value at this
// stage. The persistence path (the system of record) is exhaustively
// tested at the worker layer.
public sealed class CoachStreamEndpointTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private async Task<bool> PostgresReachable()
    {
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.Database.CanConnectAsync();
        }
        catch { return false; }
    }

    private bool RedisReachable()
    {
        try
        {
            using var mux = ConnectionMultiplexer.Connect("localhost:6379,abortConnect=false,connectTimeout=500");
            return mux.GetDatabase().Ping() < TimeSpan.FromSeconds(2);
        }
        catch { return false; }
    }

    private static AnalysisJob NewJob(Guid userId) => new()
    {
        Id = Guid.NewGuid(),
        UserId = userId,
        Status = "complete",
        DispatchedAt = DateTimeOffset.UtcNow,
        CompletedAt = DateTimeOffset.UtcNow,
    };

    private static Analysis NewAnalysis(Guid jobId, Guid userId) => new()
    {
        Id = Guid.NewGuid(),
        JobId = jobId,
        UserId = userId,
        FinalJson = "{}",
        PhaseDurations = "{}",
        CreatedAt = DateTimeOffset.UtcNow,
    };

    private record SeedResult(
        HttpClient Client,
        Guid UserId,
        Guid AnalysisId,
        Guid ConversationId,
        Guid MessageId);

    private async Task<SeedResult> SeedTerminalAssistant(
        string emailPrefix,
        string status,
        string content,
        string? evidenceJson = null,
        string? refusalReason = null)
    {
        var client = _factory.CreateClient();
        var email = $"{emailPrefix}+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email, password = "correct-horse-battery" });
        Assert.Equal(HttpStatusCode.OK, reg.StatusCode);
        var auth = await reg.Content.ReadFromJsonAsync<AuthResponse>();
        Assert.NotNull(auth);
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", auth!.AccessToken);

        Guid userId, analysisId, conversationId, messageId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            userId = user.Id;
            var job = NewJob(userId);
            db.AnalysisJobs.Add(job);
            var analysis = NewAnalysis(job.Id, userId);
            db.Analyses.Add(analysis);
            analysisId = analysis.Id;

            var conv = new Conversation
            {
                Id = Guid.NewGuid(), AnalysisId = analysisId, UserId = userId,
                CreatedAt = DateTimeOffset.UtcNow,
            };
            db.Conversations.Add(conv);
            conversationId = conv.Id;

            var msg = new CoachMessage
            {
                Id = Guid.NewGuid(), ConversationId = conv.Id,
                Role = "assistant", Status = status, Content = content,
                Evidence = evidenceJson, RefusalReason = refusalReason,
                CreatedAt = DateTimeOffset.UtcNow,
                CompletedAt = DateTimeOffset.UtcNow,
            };
            db.CoachMessages.Add(msg);
            messageId = msg.Id;

            await db.SaveChangesAsync();
        }
        return new SeedResult(client, userId, analysisId, conversationId, messageId);
    }

    private async Task CleanupUser(Guid userId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var conversations = await db.Conversations.Where(c => c.UserId == userId)
            .Select(c => c.Id).ToListAsync();
        foreach (var cid in conversations)
            await db.CoachMessages.Where(m => m.ConversationId == cid).ExecuteDeleteAsync();
        await db.Conversations.Where(c => c.UserId == userId).ExecuteDeleteAsync();
        await db.AnalysisJobs.Where(j => j.UserId == userId).ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
    }

    // ── helpers for SSE parse ──────────────────────────────────────────

    private static List<(string EventName, string Data)> ParseSseFrames(string body)
    {
        var frames = new List<(string, string)>();
        var parts = body.Split("\n\n", StringSplitOptions.RemoveEmptyEntries);
        foreach (var part in parts)
        {
            string? evt = null;
            string? data = null;
            foreach (var line in part.Split('\n'))
            {
                if (line.StartsWith("event: ")) evt = line[7..];
                else if (line.StartsWith("data: ")) data = line[6..];
            }
            if (evt is not null && data is not null) frames.Add((evt, data));
        }
        return frames;
    }

    // ── terminal short-circuit (AC5) ───────────────────────────────────

    [Fact]
    public async Task Stream_For_Complete_Row_Emits_Token_Then_Done()
    {
        if (!await PostgresReachable()) { return; }

        var evidence = "[{\"label\":\"LUFS -11.2\",\"path\":\"phase1.lufs_integrated\"}]";
        var seed = await SeedTerminalAssistant(
            "stream-complete",
            status: "complete",
            content: "Your LUFS sits at -11.2.",
            evidenceJson: evidence);

        try
        {
            var resp = await seed.Client.GetAsync(
                $"/api/coach/{seed.AnalysisId}/messages/{seed.MessageId}/stream");
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            Assert.Equal("text/event-stream", resp.Content.Headers.ContentType?.MediaType);

            var body = await resp.Content.ReadAsStringAsync();
            var frames = ParseSseFrames(body);

            Assert.Contains(frames, f => f.EventName == "token");
            Assert.Contains(frames, f => f.EventName == "done");

            var tokenFrame = frames.First(f => f.EventName == "token");
            using (var doc = JsonDocument.Parse(tokenFrame.Data.Replace("\\n", "\n")))
            {
                Assert.Equal("Your LUFS sits at -11.2.",
                    doc.RootElement.GetProperty("text").GetString());
            }

            var doneFrame = frames.Last(f => f.EventName == "done");
            using (var doc = JsonDocument.Parse(doneFrame.Data))
            {
                var ev = doc.RootElement.GetProperty("evidence");
                Assert.Equal(1, ev.GetArrayLength());
                Assert.Equal("LUFS -11.2", ev[0].GetProperty("label").GetString());
                Assert.Equal("phase1.lufs_integrated", ev[0].GetProperty("path").GetString());
            }
        }
        finally
        {
            await CleanupUser(seed.UserId);
        }
    }

    [Fact]
    public async Task Stream_For_Refused_Row_Emits_Refusal_Frame()
    {
        if (!await PostgresReachable()) { return; }

        var seed = await SeedTerminalAssistant(
            "stream-refused",
            status: "refused",
            content: "Coach is offline — your measured analysis and rule-based findings are unaffected.",
            refusalReason: "coach_offline");

        try
        {
            var resp = await seed.Client.GetAsync(
                $"/api/coach/{seed.AnalysisId}/messages/{seed.MessageId}/stream");
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

            var body = await resp.Content.ReadAsStringAsync();
            var frames = ParseSseFrames(body);
            var refusal = frames.LastOrDefault(f => f.EventName == "refusal");
            Assert.NotEqual(default, refusal);

            using var doc = JsonDocument.Parse(refusal.Data);
            Assert.Equal("coach_offline", doc.RootElement.GetProperty("reason").GetString());
            Assert.Contains("offline", doc.RootElement.GetProperty("body").GetString());
        }
        finally
        {
            await CleanupUser(seed.UserId);
        }
    }

    [Fact]
    public async Task Stream_For_Error_Row_Emits_Error_Frame()
    {
        if (!await PostgresReachable()) { return; }

        var seed = await SeedTerminalAssistant(
            "stream-error",
            status: "error",
            content: "The coach hit a transient error. Please try again.");

        try
        {
            var resp = await seed.Client.GetAsync(
                $"/api/coach/{seed.AnalysisId}/messages/{seed.MessageId}/stream");
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

            var body = await resp.Content.ReadAsStringAsync();
            var frames = ParseSseFrames(body);
            var error = frames.LastOrDefault(f => f.EventName == "error");
            Assert.NotEqual(default, error);

            using var doc = JsonDocument.Parse(error.Data);
            Assert.Equal("coach_error", doc.RootElement.GetProperty("code").GetString());
        }
        finally
        {
            await CleanupUser(seed.UserId);
        }
    }

    // ── ownership gate (AC6) ───────────────────────────────────────────

    [Fact]
    public async Task Stream_For_Other_Users_Message_Returns_404()
    {
        if (!await PostgresReachable()) { return; }

        // User A seeds a complete assistant row.
        var seedA = await SeedTerminalAssistant(
            "stream-x-userA",
            status: "complete",
            content: "User A's coach reply.",
            evidenceJson: "[]");

        // User B opens a separate client + tries to read A's stream.
        var clientB = _factory.CreateClient();
        var emailB = $"stream-x-userB+{Guid.NewGuid():N}@spectr.test";
        var regB = await clientB.PostAsJsonAsync("/api/auth/register",
            new { email = emailB, password = "correct-horse-battery" });
        Assert.Equal(HttpStatusCode.OK, regB.StatusCode);
        var authB = await regB.Content.ReadFromJsonAsync<AuthResponse>();
        clientB.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", authB!.AccessToken);

        Guid userBId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            userBId = (await db.Users.FirstAsync(u => u.Email == emailB)).Id;
        }

        try
        {
            var resp = await clientB.GetAsync(
                $"/api/coach/{seedA.AnalysisId}/messages/{seedA.MessageId}/stream");
            // 404 BEFORE any SSE bytes — no leak of stream existence.
            Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);

            // Story 1.6 code review P18: response body MUST be empty (or
            // a generic 404 envelope) — never mention that the message
            // exists in someone else's conversation. AC6: "No leak of
            // stream existence."
            var body = await resp.Content.ReadAsStringAsync();
            Assert.DoesNotContain(seedA.MessageId.ToString(), body);
            Assert.DoesNotContain(seedA.ConversationId.ToString(), body);
            Assert.DoesNotContain("User A", body);
        }
        finally
        {
            await CleanupUser(seedA.UserId);
            await CleanupUser(userBId);
        }
    }

    // ── live subscribe round-trip ──────────────────────────────────────

    [Fact]
    [Trait("Category", "Slow")]
    public async Task Stream_Live_Subscribe_Forwards_Published_Frames()
    {
        if (!await PostgresReachable()) { return; }
        if (!RedisReachable()) { return; }

        // Seed a pending assistant row directly (no enqueue) so we can
        // drive the publish ourselves.
        var seed = await SeedTerminalAssistant(
            "stream-live",
            status: "pending",
            content: "");

        // Live-subscribe path runs the relay loop. We publish from
        // another task after a short delay.
        using var mux = ConnectionMultiplexer.Connect("localhost:6379");
        var channel = new RedisChannel(
            $"coach:{seed.ConversationId}:{seed.MessageId}",
            RedisChannel.PatternMode.Literal);

        try
        {
            var requestTask = seed.Client.GetAsync(
                $"/api/coach/{seed.AnalysisId}/messages/{seed.MessageId}/stream",
                HttpCompletionOption.ResponseHeadersRead);

            // Story 1.6 code review P17: poll until PublishAsync reports at
            // least one subscriber (the BFF's relay handler). PublishAsync
            // returns the number of clients that received the message.
            // Bounded retry loop — fails fast if the subscriber never
            // attaches rather than burning a fixed-time Task.Delay.
            var sub = mux.GetSubscriber();
            var attached = false;
            for (var i = 0; i < 40 && !attached; i++)
            {
                var receivers = await sub.PublishAsync(channel,
                    "{\"type\":\"token\",\"text\":\"hi \"}");
                if (receivers >= 1) { attached = true; break; }
                await Task.Delay(50);
            }
            Assert.True(attached,
                "BFF subscriber never attached within 2 s — relay loop is broken");

            await sub.PublishAsync(channel,
                "{\"type\":\"token\",\"text\":\"there\"}");
            await sub.PublishAsync(channel,
                "{\"type\":\"done\",\"evidence\":[]}");

            var resp = await requestTask;
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            var body = await resp.Content.ReadAsStringAsync();
            var frames = ParseSseFrames(body);

            Assert.Contains(frames,
                f => f.EventName == "token" && f.Data.Contains("hi"));
            Assert.Contains(frames,
                f => f.EventName == "token" && f.Data.Contains("there"));
            Assert.Contains(frames, f => f.EventName == "done");
        }
        finally
        {
            await CleanupUser(seed.UserId);
        }
    }

    // ── client-disconnect → coach:cancel:{messageId} SET (Task 6.5) ─────

    [Fact]
    [Trait("Category", "Slow")]
    public async Task Client_Disconnect_Sets_Cancel_Key_In_Redis()
    {
        if (!await PostgresReachable()) { return; }
        if (!RedisReachable()) { return; }

        // Seed a pending assistant row — no actor enqueue, just need the
        // SSE endpoint to open the subscribe + relay loop.
        var seed = await SeedTerminalAssistant(
            "stream-cancel",
            status: "pending",
            content: "");

        using var mux = ConnectionMultiplexer.Connect("localhost:6379");
        var cancelKey = $"coach:cancel:{seed.MessageId}";

        // Make sure no stale key from a prior test run.
        await mux.GetDatabase().KeyDeleteAsync(cancelKey);

        try
        {
            // Open the SSE stream and abort it.
            using var ctsClient = new CancellationTokenSource();
            var requestTask = seed.Client.GetAsync(
                $"/api/coach/{seed.AnalysisId}/messages/{seed.MessageId}/stream",
                HttpCompletionOption.ResponseHeadersRead,
                ctsClient.Token);

            // Wait until the BFF subscriber attaches (so we know the
            // handler is past the read-row + subscribe lines and into
            // the relay loop where the finally will fire).
            var sub = mux.GetSubscriber();
            var attached = false;
            for (var i = 0; i < 40 && !attached; i++)
            {
                var receivers = await sub.PublishAsync(
                    new RedisChannel(
                        $"coach:{seed.ConversationId}:{seed.MessageId}",
                        RedisChannel.PatternMode.Literal),
                    "{\"type\":\"token\",\"text\":\"warmup\"}");
                if (receivers >= 1) { attached = true; break; }
                await Task.Delay(50);
            }
            Assert.True(attached,
                "BFF subscriber never attached — can't test disconnect path");

            // Abort the request. The BFF's finally should SET the cancel
            // key with EX 180.
            ctsClient.Cancel();
            try { await requestTask; } catch { /* expected cancellation */ }

            // Poll Redis for the cancel key — bounded wait so we don't
            // hang the suite if the SET never fires.
            var db = mux.GetDatabase();
            var found = false;
            long ttlSec = 0;
            for (var i = 0; i < 40 && !found; i++)
            {
                if (await db.KeyExistsAsync(cancelKey))
                {
                    found = true;
                    var ttl = await db.KeyTimeToLiveAsync(cancelKey);
                    ttlSec = (long)(ttl?.TotalSeconds ?? 0);
                    break;
                }
                await Task.Delay(50);
            }
            Assert.True(found,
                $"cancel key {cancelKey} was never SET — disconnect path broken");
            Assert.InRange(ttlSec, 1, 180);
        }
        finally
        {
            await mux.GetDatabase().KeyDeleteAsync(cancelKey);
            await CleanupUser(seed.UserId);
        }
    }

    private sealed record AuthResponse(string AccessToken, string RefreshToken);
}
