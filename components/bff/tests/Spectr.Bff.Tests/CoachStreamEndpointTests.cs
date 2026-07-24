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
// the TestDb.RequireAsync Postgres gate (skip-visible, story 12.7).
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

    [SkippableFact]
    public async Task Stream_For_Complete_Row_Emits_Token_Then_Done()
    {
        await TestDb.RequireAsync(_factory);

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

    [SkippableFact]
    public async Task Stream_For_Refused_Row_Emits_Refusal_Frame()
    {
        await TestDb.RequireAsync(_factory);

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

    [SkippableFact]
    public async Task Stream_For_Error_Row_Emits_Error_Frame()
    {
        await TestDb.RequireAsync(_factory);

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

    [SkippableFact]
    public async Task Stream_For_Other_Users_Message_Returns_404()
    {
        await TestDb.RequireAsync(_factory);

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

    [SkippableFact]
    [Trait("Category", "Slow")]
    public async Task Stream_Live_Subscribe_Forwards_Published_Frames()
    {
        await TestDb.RequireAsync(_factory);
        TestDb.Require(RedisReachable(), "Redis");

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

    // ── item 2 / Task 4: coach stream chunk-ordering repro + fix ─────────
    //
    // PRPs/first-upload-trust-quickwins.md item 2: a real coach reply
    // rendered two prose chunks swapped. Root cause: StackExchange.Redis's
    // delegate `sub.SubscribeAsync(channel, Handler)` overload
    // (CoachConversationEndpoints.cs) gives NO ordering guarantee, even for
    // messages on the SAME channel (see the library's own PubSubOrder.md
    // docs), unlike the ordered `SubscribeAsync(channel)` →
    // `ChannelMessageQueue.OnMessage(handler)` form.
    //
    // CONFIRMED (see PRPs/coach-stream-ordering-fix.md for full writeup):
    // Stream_Preserves_Chunk_Order_At_Low_Concurrency — a SINGLE publisher,
    // SINGLE channel, sequentially-awaited publishes (no client-side
    // concurrency at all) — failed 6 of 8 live runs against the local dev
    // stack, always an adjacent-pair swap. This is a stronger repro than
    // hypothesized: `PublishAsync` completing has no relationship to when
    // the BFF's `Handler` delegate actually runs, so the race is entirely
    // inside the BFF's per-channel dispatch, not caller-side concurrency.
    // The sibling high-concurrency test (many DIFFERENT channels, published
    // concurrently) passed 8/8 — expected, since cross-channel ordering was
    // never the invariant at risk; the bug is intra-channel, and the
    // low-concurrency test already isolates and reproduces it directly.
    // FIXED: CoachConversationEndpoints.cs now subscribes via the ordered
    // ChannelMessageQueue form (PRPs/coach-stream-ordering-fix.md).

    private static async Task<bool> PublishUntilSubscriberAttached(
        ISubscriber sub, RedisChannel channel, string primerPayload)
    {
        for (var i = 0; i < 40; i++)
        {
            var receivers = await sub.PublishAsync(channel, primerPayload);
            if (receivers >= 1) return true;
            await Task.Delay(50);
        }
        return false;
    }

    private static List<string> TokenTextsInOrder(List<(string EventName, string Data)> frames)
    {
        var texts = new List<string>();
        foreach (var f in frames)
        {
            if (f.EventName != "token") continue;
            using var doc = JsonDocument.Parse(f.Data);
            texts.Add(doc.RootElement.GetProperty("text").GetString() ?? "");
        }
        return texts;
    }

    [SkippableFact]
    [Trait("Category", "Slow")]
    public async Task Stream_Preserves_Chunk_Order_At_Low_Concurrency()
    {
        // Originally written as a "control" expected to always pass, paired
        // with a high-concurrency sibling meant to manufacture the race.
        // It turned out THIS is the one that reproduces the bug — a single
        // publisher on a single channel is already sufficient. Now a live
        // regression guard for the ChannelMessageQueue fix — see the
        // class-level comment above and PRPs/coach-stream-ordering-fix.md.
        await TestDb.RequireAsync(_factory);
        TestDb.Require(RedisReachable(), "Redis");

        const int frameCount = 30;
        var seed = await SeedTerminalAssistant("stream-order-lo", status: "pending", content: "");
        using var mux = ConnectionMultiplexer.Connect("localhost:6379");
        var channel = new RedisChannel(
            $"coach:{seed.ConversationId}:{seed.MessageId}", RedisChannel.PatternMode.Literal);

        try
        {
            var requestTask = seed.Client.GetAsync(
                $"/api/coach/{seed.AnalysisId}/messages/{seed.MessageId}/stream",
                HttpCompletionOption.ResponseHeadersRead);

            var sub = mux.GetSubscriber();
            var attached = await PublishUntilSubscriberAttached(sub, channel,
                "{\"type\":\"token\",\"text\":\"chunk-0\"}");
            Assert.True(attached, "BFF subscriber never attached within 2 s — relay loop is broken");

            for (var i = 1; i < frameCount; i++)
            {
                await sub.PublishAsync(channel, $"{{\"type\":\"token\",\"text\":\"chunk-{i}\"}}");
            }
            await sub.PublishAsync(channel, "{\"type\":\"done\",\"evidence\":[]}");

            var resp = await requestTask;
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            var body = await resp.Content.ReadAsStringAsync();
            var frames = ParseSseFrames(body);

            var texts = TokenTextsInOrder(frames);
            var expected = Enumerable.Range(0, frameCount).Select(i => $"chunk-{i}").ToList();
            Assert.Equal(expected, texts);
        }
        finally
        {
            await CleanupUser(seed.UserId);
        }
    }

    [SkippableFact]
    [Trait("Category", "Slow")]
    public async Task Stream_Preserves_Chunk_Order_At_High_Concurrency()
    {
        // Many simultaneous conversations sharing the same IConnectionMultiplexer
        // singleton (Program.cs:230-238), each publishing its own rapid chunk
        // sequence CONCURRENTLY with the others (a DIFFERENT channel per
        // conversation). CONFIRMED (8/8 live runs): this variant does not
        // reproduce reordering, unlike its low-concurrency sibling (which
        // does, reliably — see that test's Skip reason). This is consistent
        // with the confirmed root cause: the bug is in per-channel dispatch
        // ordering, and Redis Pub/Sub makes no cross-channel ordering
        // promise to begin with, so many-channels concurrency doesn't
        // exercise the actual invariant at risk. Kept as a live (non-skipped)
        // regression guard for cross-channel behavior; the low-concurrency
        // test is the one that carries the confirmed-bug evidence.
        await TestDb.RequireAsync(_factory);
        TestDb.Require(RedisReachable(), "Redis");

        const int conversationCount = 20;
        const int frameCount = 20;

        var seeds = new List<SeedResult>();
        for (var i = 0; i < conversationCount; i++)
        {
            seeds.Add(await SeedTerminalAssistant(
                $"stream-order-hi-{i}", status: "pending", content: ""));
        }

        using var mux = ConnectionMultiplexer.Connect("localhost:6379");
        var sub = mux.GetSubscriber();

        try
        {
            var requestTasks = seeds.Select(s => s.Client.GetAsync(
                $"/api/coach/{s.AnalysisId}/messages/{s.MessageId}/stream",
                HttpCompletionOption.ResponseHeadersRead)).ToList();

            // Attach every stream's subscriber before racing any publishes —
            // an early primer publish landing before the BFF's handler
            // registers would be silently dropped, not a reordering signal.
            var channels = seeds.Select(s => new RedisChannel(
                $"coach:{s.ConversationId}:{s.MessageId}", RedisChannel.PatternMode.Literal)).ToList();
            for (var i = 0; i < channels.Count; i++)
            {
                var attached = await PublishUntilSubscriberAttached(sub, channels[i],
                    "{\"type\":\"token\",\"text\":\"chunk-0\"}");
                Assert.True(attached, $"BFF subscriber {i} never attached within 2 s");
            }

            // Fire every conversation's remaining chunks CONCURRENTLY — this
            // is what manufactures concurrent dispatch across the shared
            // multiplexer (as opposed to the low-concurrency test's single
            // serial publish loop).
            var publishTasks = channels.Select(async channel =>
            {
                for (var i = 1; i < frameCount; i++)
                {
                    await sub.PublishAsync(channel, $"{{\"type\":\"token\",\"text\":\"chunk-{i}\"}}");
                }
                await sub.PublishAsync(channel, "{\"type\":\"done\",\"evidence\":[]}");
            });
            await Task.WhenAll(publishTasks);

            var responses = await Task.WhenAll(requestTasks);
            var expected = Enumerable.Range(0, frameCount).Select(i => $"chunk-{i}").ToList();

            var mismatches = new List<string>();
            for (var i = 0; i < responses.Length; i++)
            {
                Assert.Equal(HttpStatusCode.OK, responses[i].StatusCode);
                var body = await responses[i].Content.ReadAsStringAsync();
                var frames = ParseSseFrames(body);
                var texts = TokenTextsInOrder(frames);
                if (!texts.SequenceEqual(expected))
                {
                    mismatches.Add($"conversation {i}: got [{string.Join(",", texts)}]");
                }
            }

            Assert.True(mismatches.Count == 0,
                $"{mismatches.Count}/{conversationCount} conversations received out-of-order " +
                "chunks under concurrent dispatch — CONFIRMS the delegate SubscribeAsync " +
                $"ordering hypothesis (see PubSubOrder.md). Details: {string.Join(" | ", mismatches)}");
        }
        finally
        {
            foreach (var s in seeds)
                await CleanupUser(s.UserId);
        }
    }

    // ── client-disconnect → coach:cancel:{messageId} SET (Task 6.5) ─────

    [SkippableFact]
    [Trait("Category", "Slow")]
    public async Task Client_Disconnect_Sets_Cancel_Key_In_Redis()
    {
        await TestDb.RequireAsync(_factory);
        TestDb.Require(RedisReachable(), "Redis");

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
