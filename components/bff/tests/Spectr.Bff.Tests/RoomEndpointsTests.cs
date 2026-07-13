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

    // ── helpers ──────────────────────────────────────────────────────────────
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
