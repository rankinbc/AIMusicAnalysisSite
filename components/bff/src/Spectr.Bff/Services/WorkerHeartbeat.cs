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

    /// <summary>
    /// Pending messages across the analysis lanes (paid + free). Lives here so
    /// the <c>dramatiq:&lt;queue&gt;</c> LIST key format has a single owner —
    /// both health endpoints read this. Throws on Redis failure.
    /// </summary>
    Task<long> AnalysisQueueDepthAsync(CancellationToken ct = default);
}

internal sealed class WorkerHeartbeat(IConnectionMultiplexer redis) : IWorkerHeartbeat
{
    private const string DramatiqHeartbeatsKey = "dramatiq:__heartbeats__";

    // StackExchange.Redis calls take no CancellationToken; WaitAsync(ct) makes
    // the awaits cancellable so callers' probe timeouts actually cut them off.
    public async Task<long?> AgeSecondsAsync(CancellationToken ct = default)
    {
        var db = redis.GetDatabase();
        var top = await db.SortedSetRangeByRankWithScoresAsync(DramatiqHeartbeatsKey, -1, -1)
            .WaitAsync(ct);
        if (top.Length == 0)
        {
            return null;
        }
        long nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        return Math.Max(0, (nowMs - (long)top[0].Score) / 1000);
    }

    public async Task<long> AnalysisQueueDepthAsync(CancellationToken ct = default)
    {
        var db = redis.GetDatabase();
        return await db.ListLengthAsync($"dramatiq:{DramatiqQueues.AnalysisPaid}").WaitAsync(ct)
            + await db.ListLengthAsync($"dramatiq:{DramatiqQueues.AnalysisFree}").WaitAsync(ct);
    }
}
