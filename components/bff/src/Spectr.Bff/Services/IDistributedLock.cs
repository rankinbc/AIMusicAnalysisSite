using StackExchange.Redis;

namespace Spectr.Bff.Services;

// Fix round 1 item 4(b) — a short-lived Redis mutex for serialising a single
// guest's stem-staging calls (see GuestLimits.AcquireStemsLockAsync). Kept
// separate from IRateLimiter: a rate limiter answers "how many", a lock
// answers "is anyone else in this critical section right now" — different
// shapes, and faking this one small interface in tests is far cheaper than
// faking the whole StackExchange.Redis IConnectionMultiplexer surface.
public interface IDistributedLock
{
    // SET key token NX PX ttl — returns the token on success, null when
    // someone else already holds the key.
    Task<string?> TryAcquireAsync(string key, TimeSpan ttl, CancellationToken ct = default);

    // CAS release: deletes the key only if it still holds THIS token (a
    // token mismatch means the lock already expired and a later caller now
    // owns it — never steal it back). Best-effort; the caller's PX TTL is
    // the real backstop if this never runs (process death, cancelled request).
    Task ReleaseAsync(string key, string token, CancellationToken ct = default);
}

public sealed class RedisDistributedLock(IConnectionMultiplexer redis) : IDistributedLock
{
    private const string ReleaseLua = @"
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0";

    public async Task<string?> TryAcquireAsync(string key, TimeSpan ttl, CancellationToken ct = default)
    {
        _ = ct; // StackExchange.Redis calls take no CancellationToken (WorkerHeartbeat precedent).
        var token = Guid.NewGuid().ToString("N");
        var acquired = await redis.GetDatabase().StringSetAsync(key, token, ttl, When.NotExists);
        return acquired ? token : null;
    }

    public async Task ReleaseAsync(string key, string token, CancellationToken ct = default)
    {
        _ = ct;
        await redis.GetDatabase().ScriptEvaluateAsync(
            ReleaseLua, new RedisKey[] { key }, new RedisValue[] { token });
    }
}
