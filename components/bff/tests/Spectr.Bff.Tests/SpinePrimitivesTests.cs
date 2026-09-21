using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Spectr.Bff.Services;
using StackExchange.Redis;
using Xunit;

namespace Spectr.Bff.Tests;

/// <summary>
/// PRP-0 spine primitives: the Redis rate limiter (+ the JwtBearer ?t= hard
/// rule). Solo fork (task 9) pruned the ActorRef/AnonIdentity/ResourceTokenAuth
/// cases — that opaque-token/guest-identity seam was deleted along with
/// sharing. Redis + full-boot tests skip gracefully when unreachable.
/// </summary>
public sealed class SpinePrimitivesTests
{
    private static bool RedisReachable()
    {
        try
        {
            using var m = ConnectionMultiplexer.Connect(TestDb.RedisEndpoint("abortConnect=false,connectTimeout=500"));
            return m.GetDatabase().Ping() < TimeSpan.FromSeconds(2);
        }
        catch { return false; }
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

        using var mux = ConnectionMultiplexer.Connect(TestDb.RedisEndpoint("abortConnect=false"));
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

        using var mux = ConnectionMultiplexer.Connect(TestDb.RedisEndpoint("abortConnect=false"));
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

    // ── Task G7a (R3b) — IDistributedLock (Redis), directly, no HTTP round trip ──
    // The 6-parallel HTTP race test (GuestStemsByteCapAndRaceTests) exercises
    // this indirectly and also passed on the pre-fix code, so it proves
    // nothing about the lock primitive itself. This is a deterministic,
    // no-sleep test of RedisDistributedLock's actual CAS semantics.
    [SkippableFact]
    public async Task RedisDistributedLock_Acquire_Is_Exclusive_And_Release_Is_Token_Gated()
    {
        TestDb.Require(RedisReachable(), "Redis");

        using var mux = ConnectionMultiplexer.Connect(TestDb.RedisEndpoint("abortConnect=false"));
        var db = mux.GetDatabase();
        var key = "spine-lock-test-" + Guid.NewGuid().ToString("N");
        var lockSvc = new RedisDistributedLock(mux);
        try
        {
            var token = await lockSvc.TryAcquireAsync(key, TimeSpan.FromSeconds(30));
            Assert.NotNull(token);

            // A second acquire of the SAME key, before release, is refused.
            var second = await lockSvc.TryAcquireAsync(key, TimeSpan.FromSeconds(30));
            Assert.Null(second);

            // Release with the WRONG token is a no-op — the key stays held.
            await lockSvc.ReleaseAsync(key, "not-the-real-token");
            Assert.True(await db.KeyExistsAsync(key));
            var ttl = await db.KeyTimeToLiveAsync(key);
            Assert.NotNull(ttl); // the key carries a TTL, not a bare SET

            // Release with the RIGHT token frees it.
            await lockSvc.ReleaseAsync(key, token!);
            Assert.False(await db.KeyExistsAsync(key));
        }
        finally
        {
            await db.KeyDeleteAsync(key);
        }
    }
}
