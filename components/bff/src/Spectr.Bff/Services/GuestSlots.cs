using StackExchange.Redis;

namespace Spectr.Bff.Services;

// Fix wave FW1 (final review I1) — a per-guest allowance whose entries can be
// given BACK. IRateLimiter's sliding-window log records an anonymous member
// per hit, so a charge can never be refunded; here the caller names each
// entry (an upload's jobId), so an aborted upload returns its slot and a
// pending upload can be promoted to a completed one without a second charge.
//
// One Redis sorted set per allowance: member = the caller's id, score = the
// unix-ms instant at which the entry lapses on its own. Every operation first
// drops lapsed entries, and each one is a single Lua script, so a count and
// the add/move that depends on it can never interleave with another request.
public interface IGuestSlots
{
    // Count-and-add. True when `member` holds a slot after the call — a
    // member that is already held is NOT charged again. False when `limit`
    // slots are already held.
    Task<bool> TryTakeAsync(string key, string member, int limit, TimeSpan hold, CancellationToken ct = default);

    // Replaces `from` with `to` (a fresh hold) in one step. False when `from`
    // is not held (never taken, lapsed, released, or already moved) — so of
    // two racing movers exactly one wins.
    Task<bool> MoveAsync(string key, string from, string to, TimeSpan hold, CancellationToken ct = default);

    // Gives the slot back. False when it was not held (including lapsed).
    Task<bool> ReleaseAsync(string key, string member, CancellationToken ct = default);

    // Slots currently held.
    Task<long> CountAsync(string key, CancellationToken ct = default);
}

public sealed class RedisGuestSlots(IConnectionMultiplexer redis) : IGuestSlots
{
    // The key itself expires with its longest-lived entry, so an abandoned
    // guest leaves nothing behind.
    private const string TakeLua = @"
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZSCORE', KEYS[1], ARGV[2]) then return 1 end
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[4], ARGV[2])
local last = redis.call('ZRANGE', KEYS[1], -1, -1, 'WITHSCORES')
redis.call('PEXPIREAT', KEYS[1], last[2])
return 1";

    private const string MoveLua = @"
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if not redis.call('ZSCORE', KEYS[1], ARGV[2]) then return 0 end
redis.call('ZREM', KEYS[1], ARGV[2])
redis.call('ZADD', KEYS[1], ARGV[4], ARGV[3])
local last = redis.call('ZRANGE', KEYS[1], -1, -1, 'WITHSCORES')
redis.call('PEXPIREAT', KEYS[1], last[2])
return 1";

    private const string ReleaseLua = @"
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
return redis.call('ZREM', KEYS[1], ARGV[2])";

    private const string CountLua = @"
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
return redis.call('ZCARD', KEYS[1])";

    private static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    // StackExchange.Redis calls take no CancellationToken (WorkerHeartbeat /
    // RedisRateLimiter precedent) — `ct` is accepted for interface symmetry.
    public async Task<bool> TryTakeAsync(string key, string member, int limit, TimeSpan hold, CancellationToken ct = default)
    {
        _ = ct;
        var now = NowMs();
        RedisValue[] args = [now, member, limit, now + (long)hold.TotalMilliseconds];
        return (long)await redis.GetDatabase().ScriptEvaluateAsync(TakeLua, new RedisKey[] { key }, args) == 1;
    }

    public async Task<bool> MoveAsync(string key, string from, string to, TimeSpan hold, CancellationToken ct = default)
    {
        _ = ct;
        var now = NowMs();
        RedisValue[] args = [now, from, to, now + (long)hold.TotalMilliseconds];
        return (long)await redis.GetDatabase().ScriptEvaluateAsync(MoveLua, new RedisKey[] { key }, args) == 1;
    }

    public async Task<bool> ReleaseAsync(string key, string member, CancellationToken ct = default)
    {
        _ = ct;
        RedisValue[] args = [NowMs(), member];
        return (long)await redis.GetDatabase().ScriptEvaluateAsync(ReleaseLua, new RedisKey[] { key }, args) == 1;
    }

    public async Task<long> CountAsync(string key, CancellationToken ct = default)
    {
        _ = ct;
        RedisValue[] args = [NowMs()];
        return (long)await redis.GetDatabase().ScriptEvaluateAsync(CountLua, new RedisKey[] { key }, args);
    }
}
