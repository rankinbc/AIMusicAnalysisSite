using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Spectr.Bff.Options;
using Spectr.Bff.Services;
using Spectr.Data;
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
        g.MapGet("/full", GetFullHealth);
        return app;
    }

    /// <summary>
    /// Story 12.2 (AC4) — aggregated health for the dev shell indicator:
    /// postgres / redis / worker-heartbeat / storage in one JSON, each probe
    /// with a short hard timeout and its own catch-all. UNLIKE <c>/healthz</c>
    /// (the story-10.1 deploy smoke, whose 200/503 semantics are a contract),
    /// this endpoint ALWAYS returns 200 with the JSON body so the frontend can
    /// render partial state; <c>status</c> is "degraded" only when postgres or
    /// redis fail — worker/storage state is informational.
    /// </summary>
    private static async Task<IResult> GetFullHealth(
        AppDbContext db,
        IConnectionMultiplexer redis,
        IWorkerHeartbeat heartbeat,
        IOptions<WorkerOptions> opts,
        IMultipartObjectStore objectStore,
        IConfiguration config)
    {
        var timeout = TimeSpan.FromSeconds(3);

        bool postgresOk = false;
        try
        {
            using var cts = new CancellationTokenSource(timeout);
            await db.Database.ExecuteSqlRawAsync("SELECT 1", cts.Token);
            postgresOk = true;
        }
        catch { /* probe result is the payload — never throw */ }

        bool redisOk = false;
        try
        {
            await redis.GetDatabase().PingAsync().WaitAsync(timeout);
            redisOk = true;
        }
        catch { }

        bool workerHealthy = false;
        long? heartbeatAge = null;
        long queueDepth = 0;
        try
        {
            heartbeatAge = await heartbeat.AgeSecondsAsync().WaitAsync(timeout);
            workerHealthy = heartbeatAge is long age
                && age < opts.Value.HeartbeatStaleSeconds;
            var rdb = redis.GetDatabase();
            queueDepth =
                await rdb.ListLengthAsync($"dramatiq:{DramatiqQueues.AnalysisPaid}")
                + await rdb.ListLengthAsync($"dramatiq:{DramatiqQueues.AnalysisFree}");
        }
        catch { }

        var storageMode = objectStore.IsConfigured ? "s3" : "local";
        bool storageOk = false;
        try
        {
            if (objectStore.IsConfigured)
            {
                // A false (404) result still proves the S3 endpoint is
                // reachable — only a thrown connection error is a failure
                // (ObjectExistsAsync itself catches only the S3 404).
                using var cts = new CancellationTokenSource(timeout);
                await objectStore.ObjectExistsAsync("healthcheck-probe", cts.Token);
                storageOk = true;
            }
            else
            {
                // Same resolution as LocalDiskFileStorage: relative to CWD.
                var root = config["Storage:LocalRoot"];
                storageOk = !string.IsNullOrWhiteSpace(root)
                    && Directory.Exists(Path.GetFullPath(root));
            }
        }
        catch { }

        return Results.Ok(new FullHealthDto(
            postgresOk && redisOk ? "ok" : "degraded",
            new FullHealthChecks(
                postgresOk,
                redisOk,
                new WorkerHealthDto(workerHealthy, heartbeatAge, queueDepth),
                new StorageHealthDto(storageMode, storageOk))));
    }

    private static async Task<IResult> GetWorkerHealth(
        IConnectionMultiplexer redis,
        IWorkerHeartbeat heartbeat,
        IOptions<WorkerOptions> opts)
    {
        // Story 12.2: heartbeat read lives in IWorkerHeartbeat (shared with
        // the StaleJobReaper) so the ZSET key + max-score rule never drift.
        long? ageSeconds = await heartbeat.AgeSecondsAsync();

        bool healthy = ageSeconds is long age
            && age < opts.Value.HeartbeatStaleSeconds;

        // Backlog across both analysis lanes — context for the banner / ops.
        // The dramatiq queue LIST key is `dramatiq:<queue-name>`.
        var db = redis.GetDatabase();
        long queueDepth =
            await db.ListLengthAsync($"dramatiq:{DramatiqQueues.AnalysisPaid}")
            + await db.ListLengthAsync($"dramatiq:{DramatiqQueues.AnalysisFree}");

        return Results.Ok(new WorkerHealthDto(healthy, ageSeconds, queueDepth));
    }
}

/// <param name="Healthy">A worker heartbeat fresher than the stale threshold exists.</param>
/// <param name="LastHeartbeatAgeSeconds">Seconds since the most recent heartbeat; null if no worker has ever registered.</param>
/// <param name="QueueDepth">Pending messages across analysis-paid + analysis-free.</param>
public sealed record WorkerHealthDto(
    bool Healthy,
    long? LastHeartbeatAgeSeconds,
    long QueueDepth);

/// <param name="Status">"ok" when postgres AND redis pass; otherwise "degraded". Worker/storage never change it.</param>
public sealed record FullHealthDto(string Status, FullHealthChecks Checks);

public sealed record FullHealthChecks(
    bool Postgres,
    bool Redis,
    WorkerHealthDto Worker,
    StorageHealthDto Storage);

/// <param name="Mode">"local" (LocalRoot directory probe) or "s3" (HEAD reachability probe).</param>
public sealed record StorageHealthDto(string Mode, bool Ok);
