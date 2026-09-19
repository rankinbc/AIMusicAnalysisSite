using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.Mvc.Testing;
using Spectr.Bff.Services;
using StackExchange.Redis;
using Xunit;

namespace Spectr.Bff.Tests;

/// <summary>
/// PRP-0 spine primitives: ActorRef, AnonIdentity (signed cookie),
/// ResourceTokenAuth, and the Redis rate limiter. Pure/unit where possible;
/// Redis + full-boot tests skip gracefully when the dependency isn't reachable.
/// </summary>
public sealed class SpinePrimitivesTests
{
    private const string Key = "test-anon-signing-key-0123456789";

    private static bool RedisReachable()
    {
        try
        {
            using var m = ConnectionMultiplexer.Connect("localhost:6379,abortConnect=false,connectTimeout=500");
            return m.GetDatabase().Ping() < TimeSpan.FromSeconds(2);
        }
        catch { return false; }
    }

    // ── ActorRef ───────────────────────────────────────────────────────────────
    [SkippableFact]
    public void ActorKey_is_type_prefixed_so_user_and_anon_never_collide()
    {
        var id = Guid.NewGuid();
        var user = ActorRef.User(id);
        var anon = ActorRef.Anon(id.ToString());

        Assert.Equal($"user:{id}", user.ActorKey);
        Assert.Equal($"anon:{id}", anon.ActorKey);
        Assert.NotEqual(user.ActorKey, anon.ActorKey);
        Assert.Equal(ActorType.User, user.Type);
        Assert.Equal(ActorType.Anon, anon.Type);
    }

    // ── AnonIdentity: signed cookie ──────────────────────────────────────────────
    [SkippableFact]
    public void Anon_cookie_round_trips_and_rejects_forgery()
    {
        var anonId = Guid.NewGuid().ToString("N");
        var cookie = AnonIdentity.Sign(anonId, Key);

        Assert.Equal(anonId, AnonIdentity.Verify(cookie, Key));        // expected: round-trip
        Assert.Null(AnonIdentity.Verify(cookie, "another-key"));       // failure: wrong key
        Assert.Null(AnonIdentity.Verify(cookie + "ab", Key));          // failure: tampered sig
        Assert.Null(AnonIdentity.Verify("forged." + new string('a', 64), Key)); // failure: forged
        Assert.Null(AnonIdentity.Verify(null, Key));
        Assert.Null(AnonIdentity.Verify("no-dot", Key));
        Assert.Null(AnonIdentity.Verify($"{anonId}.zz", Key));         // non-hex signature
    }

    [SkippableFact]
    public void Capture_requires_resolution_then_trims_and_caps_display_name()
    {
        var anon = new AnonIdentity();
        Assert.Throws<InvalidOperationException>(() => anon.Capture("x")); // not resolved yet

        anon.AnonId = "anon-123";
        Assert.Equal("hi", anon.Capture("  hi  ").DisplayName);
        Assert.Null(anon.Capture("   ").DisplayName);
        Assert.Equal(120, anon.Capture(new string('y', 300)).DisplayName!.Length);

        var a = anon.Capture();
        Assert.Equal(ActorType.Anon, a.Type);
        Assert.Equal("anon-123", a.AnonId);
        Assert.Null(a.DisplayName);
    }

    // ── ResourceTokenAuth ────────────────────────────────────────────────────────
    private sealed class FakeResolver : ITokenResolver
    {
        public string Kind => "test";
        public Task<ResolvedResource?> ResolveAsync(string token, CancellationToken ct = default) =>
            Task.FromResult<ResolvedResource?>(
                token == "good" ? new ResolvedResource("test", Guid.Empty) : null);
    }

    [SkippableFact]
    public async Task ResourceTokenAuth_resolves_opaque_token_with_anon_actor()
    {
        var anon = new AnonIdentity { AnonId = "anon-1" };
        var auth = new ResourceTokenAuth(new[] { new FakeResolver() }, anon);
        var anonPrincipal = new ClaimsPrincipal(new ClaimsIdentity()); // unauthenticated

        var ok = await auth.ResolveAsync("test", "good", anonPrincipal);
        Assert.NotNull(ok);
        Assert.Equal(ActorType.Anon, ok!.Actor.Type);
        Assert.Equal("anon-1", ok.Actor.AnonId);
        Assert.Equal(Guid.Empty, ok.Resource.ResourceId);

        // A JWT (or any non-token string) handed in as an opaque token does NOT
        // resolve — opaque tokens are looked up, never trusted as JWTs.
        Assert.Null(await auth.ResolveAsync("test", "header.payload.sig", anonPrincipal));
        Assert.Null(await auth.ResolveAsync("unknown-kind", "good", anonPrincipal));
        Assert.Null(await auth.ResolveAsync("test", null, anonPrincipal));
    }

    // ── Hard rule: an opaque token via ?t= is NOT honored by JwtBearer ───────────
    [SkippableFact]
    public async Task Opaque_token_via_query_t_is_not_accepted_as_jwt()
    {
        TestDb.Require(RedisReachable(), "Redis"); // request pipeline touches Redis (story 12.7)
        using var factory = new WebApplicationFactory<Program>();
        var client = factory.CreateClient();

        // A protected route with a random opaque token on ?t= must 401 — ?t= is
        // whitelisted to /audio and only ever accepts a VALID JWT.
        var resp = await client.GetAsync("/api/songs?t=" + Guid.NewGuid().ToString("N"));
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    // ── IRateLimiter (Redis) ─────────────────────────────────────────────────────
    [SkippableFact]
    public async Task RateLimiter_allows_up_to_limit_then_denies()
    {
        TestDb.Require(RedisReachable(), "Redis"); // skip-visible (story 12.7)

        using var mux = ConnectionMultiplexer.Connect("localhost:6379,abortConnect=false");
        var rl = new RedisRateLimiter(mux);
        var action = "spine-test-" + Guid.NewGuid().ToString("N");
        var window = TimeSpan.FromSeconds(10);

        for (var i = 0; i < 3; i++)
            Assert.True((await rl.CheckAsync("actor-1", "1.2.3.4", action, 3, window)).Allowed);

        var denied = await rl.CheckAsync("actor-1", "1.2.3.4", action, 3, window);
        Assert.False(denied.Allowed);
        Assert.Equal(window, denied.RetryAfter);
    }

    [SkippableFact]
    public async Task RateLimiter_denies_on_shared_ip_even_with_a_fresh_actor()
    {
        TestDb.Require(RedisReachable(), "Redis"); // skip-visible (story 12.7)

        using var mux = ConnectionMultiplexer.Connect("localhost:6379,abortConnect=false");
        var rl = new RedisRateLimiter(mux);
        var action = "spine-ip-test-" + Guid.NewGuid().ToString("N");
        var ip = "9.9.9.9";
        var window = TimeSpan.FromSeconds(10);

        // Exhaust the ip arm under one anon...
        for (var i = 0; i < 2; i++)
            Assert.True((await rl.CheckAsync("anon-A", ip, action, 2, window)).Allowed);
        // ...a rotated anonId from the SAME ip is still denied (ip is the ceiling).
        Assert.False((await rl.CheckAsync("anon-B", ip, action, 2, window)).Allowed);
    }
}
