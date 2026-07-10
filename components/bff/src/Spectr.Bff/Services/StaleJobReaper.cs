using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Spectr.Bff.Options;
using Spectr.Data;

namespace Spectr.Bff.Services;

/// <summary>
/// Periodically fails analysis jobs orphaned by a dead/restarted worker.
///
/// When the dramatiq worker crashes mid-flight, the job it was running stays
/// <c>processing</c> forever and queued jobs stay <c>pending</c> — dramatiq's
/// low-traffic maintenance never requeues the unacked messages. The UI only
/// renders an error once a job is <c>failed</c>, so without this the user just
/// sees an infinite spinner. This reaper flips abandoned jobs to <c>failed</c>
/// with a clear, re-runnable message, reusing the existing job-error UI path.
///
/// Same policy as <c>scripts/recover-jobs.ps1</c> (which handles dev restarts at
/// launch); this is the always-on runtime backstop. Threshold is shared via
/// <see cref="WorkerOptions.StaleJobMinutes"/>.
///
/// BackgroundService is singleton-lifetime; AppDbContext is scoped, so every
/// tick opens a fresh scope (mirrors BillingReconciliationService).
/// </summary>
internal sealed class StaleJobReaper(
    IServiceScopeFactory scopeFactory,
    IOptions<WorkerOptions> workerOpts,
    IWorkerHeartbeat heartbeat,
    ILogger<StaleJobReaper> logger)
    : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory = scopeFactory;
    private readonly IOptions<WorkerOptions> _workerOpts = workerOpts;
    private readonly IWorkerHeartbeat _heartbeat = heartbeat;
    private readonly ILogger<StaleJobReaper> _logger = logger;

    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(60);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // do-while so the first sweep runs at startup (PeriodicTimer waits a full
        // period before its first tick). WaitForNextTickAsync returns false on
        // shutdown, so the loop exits cleanly.
        using var timer = new PeriodicTimer(Interval);
        do
        {
            try
            {
                await ReapAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "Stale-job reaper sweep failed.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    // internal — callable directly from unit tests without the 60 s timer.
    internal async Task<int> ReapAsync(CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var startedCutoff = now - TimeSpan.FromMinutes(_workerOpts.Value.StaleJobMinutes);
        // Clamp: a misconfigured grace below the processing window would fail
        // QUEUED jobs faster than started ones — inverting NFR16 entirely.
        var pendingCutoff = now - TimeSpan.FromMinutes(
            Math.Max(_workerOpts.Value.PendingGraceMinutes, _workerOpts.Value.StaleJobMinutes));

        // Story 12.2 (AC2) — heartbeat-aware FAST pending tier. A dead worker
        // (stale/absent heartbeat) has nothing draining the queue, so pending
        // jobs are failed after the much shorter PendingNoWorkerGraceMinutes.
        // A busy worker keeps its heartbeat fresh → long grace only (NFR16:
        // queued jobs behind a slow job are never false-failed). The probe is
        // best-effort: Redis unreachable = liveness UNKNOWN = long grace only
        // — a probe error must never fast-fail jobs nor stop the EF-only reap.
        var workerDead = false;
        try
        {
            var age = await _heartbeat.AgeSecondsAsync(ct);
            workerDead = age is null || age >= _workerOpts.Value.HeartbeatStaleSeconds;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogDebug(ex,
                "Worker heartbeat probe failed — treating liveness as unknown (long pending grace only).");
        }
        // Deliberately NOT clamped by StaleJobMinutes: a dead worker cannot be
        // "still working on it", so the NFR16 inversion the clamp guards
        // against does not apply here.
        var pendingNoWorkerCutoff = now - TimeSpan.FromMinutes(
            _workerOpts.Value.PendingNoWorkerGraceMinutes);

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        // Story 3.5 (NFR16) — two different abandonment signals:
        //  * PROCESSING jobs are abandoned when the worker that STARTED them
        //    went away (StaleJobMinutes from started_at) — their message was
        //    consumed, nothing will resume them; fail-and-resurface.
        //  * PENDING jobs are just queued — their message still sits in the
        //    Redis LIST and the returning worker WILL consume it. They only
        //    get failed after the much longer PendingGraceMinutes, catching a
        //    truly orphaned row (message lost) without failing a queue that's
        //    merely waiting out a worker restart or backlog.
        // error_code is deliberately NOT "invalid_file" (that triggers the BFF
        // credit-reversal read path in JobEndpoints).
        var failed = await db.AnalysisJobs
            .Where(j =>
                (j.Status == "processing" && (j.StartedAt ?? j.DispatchedAt) < startedCutoff)
                || (j.Status == "pending" && j.DispatchedAt < pendingCutoff)
                || (workerDead && j.Status == "pending" && j.DispatchedAt < pendingNoWorkerCutoff))
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(j => j.Status, "failed")
                .SetProperty(j => j.ErrorCode, "worker_unavailable")
                .SetProperty(j => j.ErrorMessage,
                    "Analysis worker stopped before this job finished. Re-run the analysis.")
                .SetProperty(j => j.CurrentPhase, "failed")
                .SetProperty(j => j.FailedAt, DateTimeOffset.UtcNow),
                ct);

        if (failed > 0)
        {
            _logger.LogWarning(
                "Stale-job reaper failed {Count} abandoned job(s) (processing > {Minutes} min / pending > {Grace} min / no-worker pending > {NoWorkerGrace} min, workerDead={WorkerDead}).",
                failed, _workerOpts.Value.StaleJobMinutes, _workerOpts.Value.PendingGraceMinutes,
                _workerOpts.Value.PendingNoWorkerGraceMinutes, workerDead);
        }

        return failed;
    }
}
