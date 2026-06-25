using StackExchange.Redis;

namespace Spectr.Bff.Services;

/// <summary>Allow/deny outcome of a rate-limit check.</summary>
public readonly record struct RateLimitResult(bool Allowed, TimeSpan RetryAfter)
{
    public static readonly RateLimitResult Ok = new(true, TimeSpan.Zero);
}

/// <summary>
/// Redis sliding-window rate limiter. For ANON the ip arm is the real ceiling —
/// anonId is cheap to rotate (clear cookies → fresh signed cookie) — so a check
/// evaluates BOTH the actorKey arm AND the ip arm and denies if EITHER is over the
/// limit. Applied by PRP-3 (comment/suggestion create) + PRP-7 (mention fan-out);
/// a deny maps to a 429 <c>ErrorEnvelope</c>.
/// </summary>
public interface IRateLimiter
{
    Task<RateLimitResult> CheckAsync(
        string actorKey, string ip, string action, int limit, TimeSpan window,
        CancellationToken ct = default);
}

public sealed class RedisRateLimiter : IRateLimiter
{
    private readonly IConnectionMultiplexer _redis;

    public RedisRateLimiter(IConnectionMultiplexer redis) => _redis = redis;

    // Atomic sliding-window LOG over both arms: drop entries older than the window,
    // deny if either arm is already at the limit, else record the hit in both.
    private const string Lua = @"
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
local cutoff = now - window
for i = 1, #KEYS do redis.call('ZREMRANGEBYSCORE', KEYS[i], 0, cutoff) end
for i = 1, #KEYS do
  if redis.call('ZCARD', KEYS[i]) >= limit then return 0 end
end
for i = 1, #KEYS do
  redis.call('ZADD', KEYS[i], now, member)
  redis.call('PEXPIRE', KEYS[i], window)
end
return 1";

    public async Task<RateLimitResult> CheckAsync(
        string actorKey, string ip, string action, int limit, TimeSpan window,
        CancellationToken ct = default)
    {
        _ = ct;
        var db = _redis.GetDatabase();
        var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var windowMs = (long)window.TotalMilliseconds;
        RedisKey[] keys =
        [
            $"ratelimit:{action}:actor:{actorKey}",
            $"ratelimit:{action}:ip:{ip}",
        ];
        // Unique member so concurrent calls within the same millisecond don't
        // collide on the sorted-set score.
        var member = $"{nowMs}-{Guid.NewGuid():N}";
        RedisValue[] args = [nowMs, windowMs, limit, member];

        var res = (long)await db.ScriptEvaluateAsync(Lua, keys, args);
        return res == 1 ? RateLimitResult.Ok : new RateLimitResult(false, window);
    }
}
