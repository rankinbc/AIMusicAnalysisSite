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
    ILogger<StaleJobReaper> logger)
    : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory = scopeFactory;
    private readonly IOptions<WorkerOptions> _workerOpts = workerOpts;
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
        var cutoff = DateTimeOffset.UtcNow
            - TimeSpan.FromMinutes(_workerOpts.Value.StaleJobMinutes);

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        // Set-based UPDATE (no entity loading). A job is abandoned when it is
        // still non-terminal AND its most-recent activity predates the cutoff.
        // error_code is deliberately NOT "invalid_file" (that triggers the BFF
        // credit-reversal read path in JobEndpoints).
        var failed = await db.AnalysisJobs
            .Where(j => (j.Status == "pending" || j.Status == "processing")
                && (j.StartedAt ?? j.DispatchedAt) < cutoff)
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
                "Stale-job reaper failed {Count} abandoned job(s) older than {Minutes} min.",
                failed, _workerOpts.Value.StaleJobMinutes);
        }

        return failed;
    }
}
