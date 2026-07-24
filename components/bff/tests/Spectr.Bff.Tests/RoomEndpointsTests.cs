using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using StackExchange.Redis;
using System.Net;
using System.Text.Json;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Listen V3 (PRP-4) — Room sessions. Postgres + Redis gated. Covers the hosting
// flag gate on start, per-event authority (host-only transport, host grant →
// control_grants + auto-revoke of the prior holder), grantee-save provenance
// (Suggestion.created_in_session_id, proves D4.3), the finalize enqueue, and a
// reaction landing in the Redis WAL. The SSE relay itself is exercised manually
// (Level 3) — these pin the durable + authority surface.
public sealed class RoomEndpointsTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    [SkippableFact]
    public async Task StartSession_BlockedWhenHostingDisabled()
    {
        await TestDb.RequireAsync(_factory);
        var (owner, _, _) = await NewAuthedClient();
        var versionId = await CreateVersion(owner);

        // No room_hosting_enabled flag → RoomHostable is false for everyone.
        var resp = await owner.PostAsync($"/api/versions/{versionId}/sessions", null);
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    [SkippableFact]
    public async Task Host_GrantsRack_CreatesActiveGrant_AndAutoRevokesPrior()
    {
        await TestDb.RequireAsync(_factory);
        var (owner, _, ownerId) = await NewAuthedClient();
        var versionId = await CreateVersion(owner);
        var (_, r1Email, r1Id) = await NewAuthedClient();
        var (_, r2Email, r2Id) = await NewAuthedClient();
        await owner.PostAsJsonAsync($"/api/versions/{versionId}/invites", new { role = "reviewer", invitedEmail = r1Email });
        await owner.PostAsJsonAsync($"/api/versions/{versionId}/invites", new { role = "reviewer", invitedEmail = r2Email });
        var sessionId = await InsertLiveSession(versionId, ownerId);

        var g1 = await owner.PostAsJsonAsync($"/api/sessions/{sessionId}/grant",
            new { scope = "rack", grantee = new { userId = r1Id } });
        Assert.Equal(HttpStatusCode.OK, g1.StatusCode);
        var grant = await g1.Content.ReadFromJsonAsync<ControlGrantDto>();
        Assert.Equal("rack", grant!.Scope);
        Assert.Equal(r1Id, grant.Grantee.UserId);

        // Grant the same scope again → the prior active holder is auto-revoked.
        var g2 = await owner.PostAsJsonAsync($"/api/sessions/{sessionId}/grant",
            new { scope = "rack", grantee = new { userId = r2Id } });
        Assert.Equal(HttpStatusCode.OK, g2.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var active = await db.ControlGrants.AsNoTracking()
            .Where(x => x.SessionId == sessionId && x.Scope == "rack" && x.RevokedAt == null)
            .ToListAsync();
        Assert.Single(active);
        Assert.Equal(r2Id, active[0].GranteeUserId);
    }

    [SkippableFact]
    public async Task Transport_HostAllowed_JoinedNonHostForbidden()
    {
        await TestDb.RequireAsync(_factory);
        var (owner, _, ownerId) = await NewAuthedClient();
        var versionId = await CreateVersion(owner);
        // Public + public-join so an uninvited authed user is roomJoinable.
        await owner.PutAsJsonAsync($"/api/versions/{versionId}/share",
            new { visibility = "public", sessionJoinPolicy = "public" });
        var sessionId = await InsertLiveSession(versionId, ownerId);

        var hostMove = await owner.PostAsJsonAsync($"/api/sessions/{sessionId}/transport",
            new { playing = true, position = 12.0 });
        Assert.Equal(HttpStatusCode.Accepted, hostMove.StatusCode);

        var (attacker, _, _) = await NewAuthedClient();
        var attackerMove = await attacker.PostAsJsonAsync($"/api/sessions/{sessionId}/transport",
            new { playing = false, position = 0.0 });
        Assert.Equal(HttpStatusCode.Forbidden, attackerMove.StatusCode);
    }

    [SkippableFact]
    public async Task GranteeSave_SetsSessionProvenance_OnSuggestion()
    {
        await TestDb.RequireAsync(_factory);
        var (owner, _, ownerId) = await NewAuthedClient();
        var versionId = await CreateVersion(owner);
        var (reviewer, reviewerEmail, reviewerId) = await NewAuthedClient();
        await owner.PostAsJsonAsync($"/api/versions/{versionId}/invites", new { role = "reviewer", invitedEmail = reviewerEmail });
        var sessionId = await InsertLiveSession(versionId, ownerId);
        var grantId = await InsertRackGrant(sessionId, ownerId, reviewerId);

        // Reviewer holds the rack grant → the suggestion they save carries the
        // session + grant provenance (the cross-author credit chain, D4.3).
        var sugg = await (await reviewer.PostAsJsonAsync($"/api/versions/{versionId}/suggestions",
            new { chain = new { order = new[] { "eq" }, modules = new { }, masterBypass = false }, sessionId }))
            .Content.ReadFromJsonAsync<SuggestionDto>();
        Assert.Equal(sessionId, sugg!.CreatedInSessionId);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var row = await db.Suggestions.AsNoTracking().FirstAsync(s => s.Id == sugg.Id);
        Assert.Equal(sessionId, row.CreatedInSessionId);
        Assert.Equal(grantId, row.ViaGrantId);
    }

    [SkippableFact]
    public async Task EndSession_HostEnqueuesSynthesizeRecap()
    {
        await TestDb.RequireAsync(_factory);
        var queue = new RecordingRoomQueue();
        var f = _factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll(typeof(IJobQueue));
            s.AddSingleton<IJobQueue>(queue);
        }));
        var owner = f.CreateClient();
        var ownerId = await Register(owner);
        var versionId = await CreateVersion(owner);
        var sessionId = await InsertLiveSession(versionId, ownerId);

        var end = await owner.PostAsync($"/api/sessions/{sessionId}/end", null);
        Assert.Equal(HttpStatusCode.Accepted, end.StatusCode);
        Assert.Contains(queue.Calls, c =>
            c.Task == "synthesize_recap" && c.Queue == DramatiqQueues.AnalysisPaid);
    }

    [SkippableFact]
    public async Task EndSession_PublishesTransientEndedEvent()
    {
        await TestDb.RequireAsync(_factory);
        TestDb.Require(RedisReachable(), "Redis");
        var queue = new RecordingRoomQueue();
        var f = _factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll(typeof(IJobQueue));
            s.AddSingleton<IJobQueue>(queue);
        }));
        var owner = f.CreateClient();
        var ownerId = await Register(owner);
        var versionId = await CreateVersion(owner);
        var sessionId = await InsertLiveSession(versionId, ownerId);

        // Subscribe to the raw room channel BEFORE the POST, then poll for the
        // transient publish (CoachStreamEndpointTests receivers pattern). The
        // ended signal is publish-only: it must NOT land in the WAL.
        using var mux = ConnectionMultiplexer.Connect("localhost:6379");
        var channel = new RedisChannel($"room:{sessionId:N}", RedisChannel.PatternMode.Literal);
        var received = new List<string>();
        await mux.GetSubscriber().SubscribeAsync(channel, (_, value) =>
        {
            var p = value.ToString();
            if (!string.IsNullOrEmpty(p)) lock (received) received.Add(p);
        });

        var end = await owner.PostAsync($"/api/sessions/{sessionId}/end", null);
        Assert.Equal(HttpStatusCode.Accepted, end.StatusCode);

        var ended = new List<string>();
        for (var i = 0; i < 40; i++)
        {
            lock (received) ended = received.Where(m => m.Contains("\"type\":\"ended\"")).ToList();
            if (ended.Count > 0) break;
            await Task.Delay(50);
        }
        // Small settle window so a duplicate publish (a bug) would be caught.
        await Task.Delay(100);
        lock (received) ended = received.Where(m => m.Contains("\"type\":\"ended\"")).ToList();
        Assert.Single(ended);
        Assert.Contains("\"at\":", ended[0]);
        Assert.DoesNotContain("\"seq\":", ended[0]);

        // Publish-only: the WAL must not contain the transient ended signal.
        var redis = _factory.Services.GetRequiredService<IConnectionMultiplexer>();
        var log = await redis.GetDatabase().ListRangeAsync($"room:{sessionId:N}:log");
        Assert.DoesNotContain(log, e => e.HasValue && e.ToString().Contains("\"ended\""));
    }

    [SkippableFact]
    public async Task React_OnLiveSession_AppendsToRedisLog()
    {
        await TestDb.RequireAsync(_factory);
        var (owner, _, ownerId) = await NewAuthedClient();
        var versionId = await CreateVersion(owner);
        var sessionId = await InsertLiveSession(versionId, ownerId);

        var resp = await owner.PostAsJsonAsync($"/api/sessions/{sessionId}/react", new { emoji = "🔥", t = 64.0 });
        Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);

        var redis = _factory.Services.GetRequiredService<IConnectionMultiplexer>();
        var log = await redis.GetDatabase().ListRangeAsync($"room:{sessionId:N}:log");
        Assert.Contains(log, e => e.HasValue && e.ToString().Contains("\"reaction\""));

        // Unknown emoji is rejected by the server-side vocabulary check.
        var bad = await owner.PostAsJsonAsync($"/api/sessions/{sessionId}/react", new { emoji = "🚀" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
    }

    // ── item 2 follow-up: coach-stream-ordering-fix (PRPs/coach-stream-ordering-fix.md) ──
    //
    // Room's SSE relay used the identical delegate SubscribeAsync(channel, Handler)
    // pattern as Coach's — same no-ordering-guarantee exposure, just never exercised
    // by a test before now. This test establishes the PRE-FIX baseline; Task 4 makes
    // it pass reliably by switching Room's subscribe call to the ordered
    // ChannelMessageQueue form (identical fix to Coach's).
    [SkippableFact]
    [Trait("Category", "Slow")]
    public async Task Stream_Preserves_Event_Order_At_Low_Concurrency()
    {
        await TestDb.RequireAsync(_factory);
        TestDb.Require(RedisReachable(), "Redis");

        const int frameCount = 30;
        var (owner, _, ownerId) = await NewAuthedClient();
        var versionId = await CreateVersion(owner);
        var sessionId = await InsertLiveSession(versionId, ownerId);

        using var mux = ConnectionMultiplexer.Connect("localhost:6379");
        var sub = mux.GetSubscriber();
        var channel = new RedisChannel($"room:{sessionId:N}", RedisChannel.PatternMode.Literal);

        using var cts = new CancellationTokenSource();
        var requestTask = owner.GetAsync(
            $"/api/sessions/{sessionId}/stream", HttpCompletionOption.ResponseHeadersRead, cts.Token);

        // Payloads carry no "seq" field, so RoomEndpoints.cs's SeqOf(...) falls back
        // to long.MaxValue and the relay forwards every one of them — no need to
        // route these through RoomBus's WAL/seq machinery to exercise the bug.
        var attached = await PublishUntilSubscriberAttached(sub, channel,
            "{\"type\":\"marker\",\"text\":\"chunk-0\"}");
        Assert.True(attached, "BFF subscriber never attached within 2 s — relay loop is broken");

        for (var i = 1; i < frameCount; i++)
        {
            await sub.PublishAsync(channel, $"{{\"type\":\"marker\",\"text\":\"chunk-{i}\"}}");
        }

        try
        {
            var resp = await requestTask;
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

            var stream = await resp.Content.ReadAsStreamAsync(cts.Token);
            // The reader's own presence-join event lands on this channel too
            // (published via RoomBus before RelayLoop starts draining), so we
            // count only "marker"-typed frames, not raw SSE frame count.
            bool IsMarkerFrame((string EventName, string Data) f)
            {
                if (f.EventName != "event") return false;
                using var doc = JsonDocument.Parse(f.Data);
                return doc.RootElement.TryGetProperty("type", out var t) && t.GetString() == "marker";
            }
            var frames = await ReadSseFramesUntil(stream, IsMarkerFrame, frameCount, TimeSpan.FromSeconds(10));

            var texts = MarkerTextsInOrder(frames);
            var expected = Enumerable.Range(0, frameCount).Select(i => $"chunk-{i}").ToList();
            Assert.Equal(expected, texts);
        }
        finally
        {
            cts.Cancel();
        }
    }

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

    private static async Task<List<(string EventName, string Data)>> ReadSseFramesUntil(
        Stream stream, Func<(string EventName, string Data), bool> countPredicate,
        int targetCount, TimeSpan timeout)
    {
        using var readCts = new CancellationTokenSource(timeout);
        var frames = new List<(string, string)>();
        using var reader = new StreamReader(stream);
        string? evt = null;
        string? data = null;
        try
        {
            while (frames.Count(countPredicate) < targetCount)
            {
                var line = await reader.ReadLineAsync(readCts.Token);
                if (line is null) break;
                if (line.Length == 0)
                {
                    if (evt is not null && data is not null) frames.Add((evt, data));
                    evt = null;
                    data = null;
                    continue;
                }
                if (line.StartsWith("event: ")) evt = line[7..];
                else if (line.StartsWith("data: ")) data = line[6..];
            }
        }
        catch (OperationCanceledException) { /* timed out — return whatever was captured */ }
        return frames;
    }

    private static List<string> MarkerTextsInOrder(List<(string EventName, string Data)> frames)
    {
        var texts = new List<string>();
        foreach (var f in frames)
        {
            if (f.EventName != "event") continue;
            using var doc = JsonDocument.Parse(f.Data);
            if (!doc.RootElement.TryGetProperty("type", out var t) || t.GetString() != "marker") continue;
            texts.Add(doc.RootElement.GetProperty("text").GetString() ?? "");
        }
        return texts;
    }

    // ── helpers ──────────────────────────────────────────────────────────────
    private static bool RedisReachable()
    {
        try
        {
            using var mux = ConnectionMultiplexer.Connect("localhost:6379,abortConnect=false,connectTimeout=500");
            return mux.GetDatabase().Ping() < TimeSpan.FromSeconds(2);
        }
        catch { return false; }
    }

    private sealed class RecordingRoomQueue : IJobQueue
    {
        public readonly List<(string Task, string Queue)> Calls = new();
        public Task EnqueueAsync(string taskName, object[] args, CancellationToken ct = default)
            => EnqueueAsync(taskName, args, DramatiqQueues.Default, ct);
        public Task EnqueueAsync(string taskName, object[] args, string queueName, CancellationToken ct = default)
        {
            Calls.Add((taskName, queueName));
            return Task.CompletedTask;
        }
        public Task EnqueueDelayedAsync(string taskName, object[] args, string queueName, TimeSpan delay, CancellationToken ct = default)
        {
            Calls.Add((taskName, queueName));
            return Task.CompletedTask;
        }
    }

    private async Task<(HttpClient Client, string Email, Guid UserId)> NewAuthedClient()
    {
        var client = _factory.CreateClient();
        var (email, userId) = await RegisterReturning(client);
        return (client, email, userId);
    }

    private async Task<Guid> Register(HttpClient client) => (await RegisterReturning(client)).UserId;

    private async Task<(string Email, Guid UserId)> RegisterReturning(HttpClient client)
    {
        var email = $"room+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email, password = "correct-horse-battery" });
        reg.EnsureSuccessStatusCode();
        var auth = await reg.Content.ReadFromJsonAsync<AuthResponse>();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth!.AccessToken);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var userId = await db.Users.AsNoTracking().Where(u => u.Email == email).Select(u => u.Id).FirstAsync();
        return (email, userId);
    }

    private static async Task<Guid> CreateVersion(HttpClient client)
    {
        using var form = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(new byte[512]);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        form.Add(fileContent, "file", "room-test.wav");
        form.Add(new StringContent("false"), "analyze");
        var resp = await client.PostAsync("/api/versions/", form);
        resp.EnsureSuccessStatusCode();
        return (await resp.Content.ReadFromJsonAsync<UploadResponse>())!.VersionId;
    }

    private async Task<Guid> InsertLiveSession(Guid versionId, Guid hostId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var session = new ListeningSession
        {
            Id = Guid.NewGuid(),
            SongVersionId = versionId,
            HostId = hostId,
            Status = "live",
        };
        db.ListeningSessions.Add(session);
        await db.SaveChangesAsync();
        return session.Id;
    }

    private async Task<Guid> InsertRackGrant(Guid sessionId, Guid grantedBy, Guid granteeUserId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var grant = new ControlGrant
        {
            Id = Guid.NewGuid(),
            SessionId = sessionId,
            Scope = "rack",
            GranteeUserId = granteeUserId,
            GrantedBy = grantedBy,
        };
        db.ControlGrants.Add(grant);
        await db.SaveChangesAsync();
        return grant.Id;
    }

}
