using Microsoft.Extensions.Options;
using Spectr.Bff.Options;
using Spectr.Bff.Services;
using StackExchange.Redis;

namespace Spectr.Bff.Endpoints;

/// <summary>
/// Liveness signals for the frontend. <c>GET /api/health/worker</c> reports
/// whether the dramatiq analysis worker is alive, by reading the most recent
/// heartbeat from the <c>dramatiq:__heartbeats__</c> ZSET (scores are unix-ms
/// timestamps; a live worker refreshes every few seconds). The frontend polls
/// this to show a global "worker offline" banner so a crash is visible system-
/// wide, not just as a per-job failure.
/// </summary>
public static class HealthEndpoints
{
    public static IEndpointRouteBuilder MapHealthEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/health").WithTags("health").AllowAnonymous();
        g.MapGet("/worker", GetWorkerHealth);
        return app;
    }

    private static async Task<IResult> GetWorkerHealth(
        IConnectionMultiplexer redis,
        IOptions<WorkerOptions> opts)
    {
        var db = redis.GetDatabase();

        // Highest score in the ZSET = most recent heartbeat across all worker
        // instances. Taking the MAX means lingering dead-worker entries are
        // harmless — only the freshest heartbeat decides liveness.
        long? lastHeartbeatMs = null;
        var top = await db.SortedSetRangeByRankWithScoresAsync(
            DramatiqHeartbeatsKey, -1, -1);
        if (top.Length > 0)
        {
            lastHeartbeatMs = (long)top[0].Score;
        }

        long nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        long? ageSeconds = lastHeartbeatMs is long ms
            ? Math.Max(0, (nowMs - ms) / 1000)
            : null;

        bool healthy = ageSeconds is long age
            && age < opts.Value.HeartbeatStaleSeconds;

        // Backlog across both analysis lanes — context for the banner / ops.
        // The dramatiq queue LIST key is `dramatiq:<queue-name>`.
        long queueDepth =
            await db.ListLengthAsync($"dramatiq:{DramatiqQueues.AnalysisPaid}")
            + await db.ListLengthAsync($"dramatiq:{DramatiqQueues.AnalysisFree}");

        return Results.Ok(new WorkerHealthDto(healthy, ageSeconds, queueDepth));
    }

    private const string DramatiqHeartbeatsKey = "dramatiq:__heartbeats__";
}

/// <param name="Healthy">A worker heartbeat fresher than the stale threshold exists.</param>
/// <param name="LastHeartbeatAgeSeconds">Seconds since the most recent heartbeat; null if no worker has ever registered.</param>
/// <param name="QueueDepth">Pending messages across analysis-paid + analysis-free.</param>
public sealed record WorkerHealthDto(
    bool Healthy,
    long? LastHeartbeatAgeSeconds,
    long QueueDepth);
