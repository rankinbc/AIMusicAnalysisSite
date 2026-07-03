using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Spectr.Data;

namespace Spectr.Bff.Services;

// Story 3.4 (AR22/NFR26) — the nightly retention driver. The AUTHORITATIVE
// purge lives in the worker's `sweep_retention` actor (maintenance queue);
// this scheduler only (a) sends due retention-warning emails (AC2 — the BFF
// owns EF access to subscriptions/users) and (b) enqueues the sweep.
//
// Warning dedupe is the schedule itself: warnings go out only when the days
// remaining until a lapsed user's purge date equal a configured boundary
// (default 7 and 1) — a nightly cadence therefore sends each notice once.
public sealed class RetentionOptions
{
    public const string SectionName = "Retention";

    public bool Enabled { get; set; } = true;
    public int LapsedDays { get; set; } = 90;   // must mirror worker RETENTION_LAPSED_DAYS
    public int[] WarnAtDays { get; set; } = [7, 1];
    // First run waits this long after boot (then every 24 h). Non-zero so the
    // startup run keeps the frequently-redeployed-host property WITHOUT firing
    // during test-host startup (WebApplicationFactory) or deploy health checks.
    public int InitialDelayMinutes { get; set; } = 5;
}

internal sealed class RetentionSweepScheduler(
    IServiceScopeFactory scopeFactory,
    IOptions<RetentionOptions> options,
    ILogger<RetentionSweepScheduler> logger)
    : BackgroundService
{
    private static readonly string[] LapsedStatuses = ["canceled", "unpaid", "incomplete_expired"];
    private static readonly string[] PaidStatuses = ["active", "trialing", "past_due"];

    private readonly IServiceScopeFactory _scopeFactory = scopeFactory;
    private readonly IOptions<RetentionOptions> _options = options;
    private readonly ILogger<RetentionSweepScheduler> _logger = logger;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Same do-while shape as BillingReconciliationService (run soon after
        // boot, then every 24 h) — but with an initial delay: unlike the
        // read-only reconciliation, this service ENQUEUES work, and an
        // immediate startup run would fire into every WebApplicationFactory
        // test host and every deploy restart before the worker is up.
        try
        {
            await Task.Delay(
                TimeSpan.FromMinutes(Math.Max(0, _options.Value.InitialDelayMinutes)),
                stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        using var timer = new PeriodicTimer(TimeSpan.FromHours(24));
        do
        {
            try
            {
                await RunOnceAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "Retention sweep scheduling failed.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    // internal test seam (InternalsVisibleTo) — called without the timer.
    internal async Task RunOnceAsync(CancellationToken ct)
    {
        var opts = _options.Value;
        if (!opts.Enabled)
        {
            _logger.LogInformation("Retention sweep disabled; skipping.");
            return;
        }

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var email = scope.ServiceProvider.GetRequiredService<IEmailSender>();
        var queue = scope.ServiceProvider.GetRequiredService<IJobQueue>();

        await SendDueWarningsAsync(db, email, opts, ct);

        await queue.EnqueueAsync(
            DramatiqTasks.SweepRetention, [], DramatiqQueues.Maintenance, ct);
        _logger.LogInformation("Retention sweep enqueued on {Queue}.", DramatiqQueues.Maintenance);
    }

    private async Task SendDueWarningsAsync(
        AppDbContext db, IEmailSender email, RetentionOptions opts, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var sentinelCutoff = now.AddYears(5); // SubscriptionMirrorService missing-field sentinel

        // Lapsed subs whose purge date is in the future — warning candidates.
        var lapsed = await db.Subscriptions.AsNoTracking()
            .Where(s => LapsedStatuses.Contains(s.Status)
                && s.CurrentPeriodEnd < sentinelCutoff
                && s.CurrentPeriodEnd > now.AddDays(-opts.LapsedDays))
            .Select(s => new { s.UserId, s.CurrentPeriodEnd })
            .ToListAsync(ct);

        foreach (var sub in lapsed)
        {
            // A paid signal (re-subscribe, credits) always wins — no warning.
            var isPaid = await db.Subscriptions.AsNoTracking()
                    .AnyAsync(s => s.UserId == sub.UserId && PaidStatuses.Contains(s.Status), ct)
                || await db.CreditLedger.AsNoTracking()
                    .Where(e => e.UserId == sub.UserId)
                    .SumAsync(e => (int?)e.Amount, ct) > 0;
            if (isPaid) continue;

            var purgeDate = sub.CurrentPeriodEnd.AddDays(opts.LapsedDays);
            var daysLeft = (int)Math.Ceiling((purgeDate - now).TotalDays);
            if (!opts.WarnAtDays.Contains(daysLeft)) continue;

            var address = await db.Users.AsNoTracking()
                .Where(u => u.Id == sub.UserId && u.IsActive)
                .Select(u => u.Email)
                .FirstOrDefaultAsync(ct);
            if (address is null) continue;

            await email.SendAsync(address, "retention-warning", new Dictionary<string, string>
            {
                ["purgeDate"] = purgeDate.ToString("yyyy-MM-dd"),
                ["daysLeft"] = daysLeft.ToString(),
            }, ct);
        }
    }
}
