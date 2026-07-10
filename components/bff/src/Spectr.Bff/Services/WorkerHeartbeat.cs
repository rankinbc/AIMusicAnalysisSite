using StackExchange.Redis;

namespace Spectr.Bff.Services;

/// <summary>
/// Single source of truth for reading the dramatiq worker heartbeat: the
/// <c>dramatiq:__heartbeats__</c> ZSET (scores are unix-ms timestamps, written
/// by dramatiq's Redis broker automatically). The MAX score is the freshest
/// heartbeat across all worker instances, so lingering dead-worker entries are
/// harmless. Consumed by <c>GET /api/health/worker</c> and the
/// <c>StaleJobReaper</c> (story 12.2) so the key + max-score rule never drift.
/// </summary>
public interface IWorkerHeartbeat
{
    /// <summary>
    /// Seconds since the most recent worker heartbeat; null if no worker has
    /// ever registered. Throws on Redis failure — callers own the fail-safe
    /// semantics (the reaper treats a probe error as "liveness unknown" and
    /// only applies the long pending grace).
    /// </summary>
    Task<long?> AgeSecondsAsync(CancellationToken ct = default);
}

internal sealed class WorkerHeartbeat(IConnectionMultiplexer redis) : IWorkerHeartbeat
{
    private const string DramatiqHeartbeatsKey = "dramatiq:__heartbeats__";

    public async Task<long?> AgeSecondsAsync(CancellationToken ct = default)
    {
        var db = redis.GetDatabase();
        var top = await db.SortedSetRangeByRankWithScoresAsync(DramatiqHeartbeatsKey, -1, -1);
        if (top.Length == 0)
        {
            return null;
        }
        long nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        return Math.Max(0, (nowMs - (long)top[0].Score) / 1000);
    }
}
