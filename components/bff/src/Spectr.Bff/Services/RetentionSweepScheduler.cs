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

        // Enqueue the AUTHORITATIVE purge first — a warning-pass failure must
        // never block the sweep. LapsedDays rides as an actor arg so warnings
        // and purge share ONE policy value (no BFF-config/worker-env drift).
        await queue.EnqueueAsync(
            DramatiqTasks.SweepRetention, [opts.LapsedDays], DramatiqQueues.Maintenance, ct);
        _logger.LogInformation("Retention sweep enqueued on {Queue}.", DramatiqQueues.Maintenance);

        var cfg = scope.ServiceProvider.GetRequiredService<IConfiguration>();
        await SendDueWarningsAsync(db, email, opts, cfg, ct);

        // Task D7 (spec D8) — guest sandboxes cannot self-delete (POST
        // /api/me/delete is guard-denied for guests, Auth/GuestGuard.cs);
        // this nightly pass is the ONLY path off an expired guest row. A
        // warning-pass or sweep-enqueue failure above must never block it.
        await PurgeExpiredGuestsAsync(scope.ServiceProvider, ct);
    }

    // internal test seam (InternalsVisibleTo). Batches so a backlog of
    // thousands of guests never holds one giant transaction or a single
    // DbContext with an unbounded change tracker — each batch gets its own
    // scope (own DbContext), and each guest gets its own try/catch so one
    // bad row can't stop the rest (left for the next nightly run).
    internal async Task<int> PurgeExpiredGuestsAsync(IServiceProvider sp, CancellationToken ct)
    {
        const int BatchSize = 200;
        var scopeFactory = sp.GetRequiredService<IServiceScopeFactory>();
        var now = DateTimeOffset.UtcNow;
        var purged = 0;

        while (!ct.IsCancellationRequested)
        {
            using var batchScope = scopeFactory.CreateScope();
            var db = batchScope.ServiceProvider.GetRequiredService<AppDbContext>();
            var teardown = batchScope.ServiceProvider.GetRequiredService<AccountTeardown>();
            var queue = batchScope.ServiceProvider.GetRequiredService<IJobQueue>();

            // Predicate lives in exactly ONE place, and it's a query on
            // IsGuest — never the email suffix. D5 ruling: a NULL
            // guest_expires_at on a guest row counts as expired (a stray row
            // from a failed seed must not live forever). A real user can
            // never match this (IsGuest is always false for one), even if
            // some inconsistent row happened to carry a past
            // guest_expires_at or a guest-looking email.
            var batch = await db.Users
                .Where(u => u.IsGuest && (u.GuestExpiresAt == null || u.GuestExpiresAt < now))
                .OrderBy(u => u.CreatedAt)
                .Take(BatchSize)
                .ToListAsync(ct);
            if (batch.Count == 0) break;

            foreach (var guest in batch)
            {
                try
                {
                    var deviceId = guest.GuestDeviceId;
                    await teardown.TearDownAsync(guest, "guest_purge", "guest sandbox expired", ct);
                    await queue.EnqueueAsync(
                        DramatiqTasks.DeleteAccountData, [guest.Id.ToString()], DramatiqQueues.Maintenance, ct);

                    // D5 review finding: a guest's OWN device (users.guest_
                    // device_id) is a pointer TearDownAsync never touches —
                    // it only unclaims devices.claimed_by_user_id (a
                    // different relationship real users also use). Delete
                    // the device row only when nothing still needs it: a
                    // later-purged guest sharing the same device (resume
                    // flow), or ANY user (real or guest) that has since
                    // claimed it, must keep it alive.
                    if (deviceId is not null)
                    {
                        var stillReferenced = await db.Users.AnyAsync(u => u.GuestDeviceId == deviceId, ct)
                            || await db.Devices.AnyAsync(d => d.Id == deviceId && d.ClaimedByUserId != null, ct);
                        if (!stillReferenced)
                            await db.Devices.Where(d => d.Id == deviceId).ExecuteDeleteAsync(ct);
                    }

                    purged++;
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    _logger.LogError(ex, "Guest purge failed for {UserId} — left for the next nightly run.", guest.Id);
                }
            }
        }

        if (purged > 0)
            _logger.LogInformation("Guest purge: {Count} expired guest sandbox(es) torn down.", purged);
        return purged;
    }

    private async Task SendDueWarningsAsync(
        AppDbContext db, IEmailSender email, RetentionOptions opts, IConfiguration cfg, CancellationToken ct)
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
            try
            {
                await WarnOneAsync(db, email, opts, cfg, sub.UserId, sub.CurrentPeriodEnd, now, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // One bad address/row must never block the remaining warnings
                // (nor the sweep — already enqueued above).
                _logger.LogError(ex, "Retention warning failed for user {UserId}.", sub.UserId);
            }
        }
    }

    private static async Task WarnOneAsync(
        AppDbContext db, IEmailSender email, RetentionOptions opts, IConfiguration cfg,
        Guid userId, DateTimeOffset periodEnd, DateTimeOffset now, CancellationToken ct)
    {
        // A paid signal (re-subscribe, credits) always wins — no warning.
        var isPaid = await db.Subscriptions.AsNoTracking()
                .AnyAsync(s => s.UserId == userId && PaidStatuses.Contains(s.Status), ct)
            || await db.CreditLedger.AsNoTracking()
                .Where(e => e.UserId == userId)
                .SumAsync(e => (int?)e.Amount, ct) > 0;
        if (isPaid) return;

        var purgeDate = periodEnd.AddDays(opts.LapsedDays);
        var daysLeft = (int)Math.Ceiling((purgeDate - now).TotalDays);
        // The notice TIER currently due: the smallest boundary >= daysLeft.
        // `<=` (not equality) so a skipped nightly run — downtime, redeploy
        // drift — still sends the notice on the next run instead of never.
        var due = opts.WarnAtDays.Where(b => daysLeft <= b).DefaultIfEmpty(0).Min();
        if (due == 0) return;

        var address = await db.Users.AsNoTracking()
            .Where(u => u.Id == userId && u.IsActive)
            .Select(u => u.Email)
            .FirstOrDefaultAsync(ct);
        if (address is null) return;

        // Send-ledger + in-app surface in one: a digest-keyed notifications
        // row. The partial-unique index on digest_key makes the insert the
        // dedupe — restarts, extra runs, and multiple BFF replicas all
        // collapse to ONE email per (user, lapse cycle, notice tier).
        db.Notifications.Add(new Spectr.Data.Entities.Notification
        {
            RecipientUserId = userId,
            EventType = "retention_warning",
            DigestKey = $"retention_warn:{userId}:{periodEnd:yyyyMMdd}:{due}",
            PayloadJson = $"{{\"purgeDate\":\"{purgeDate:yyyy-MM-dd}\",\"daysLeft\":{daysLeft}}}",
        });
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            db.ChangeTracker.Clear();
            return; // this notice tier was already sent for this lapse cycle
        }

        // Story 4.4 (AC3 fix): billingUrl was missing — the template's
        // KEEP MY FILES button rendered href="" since 3.4.
        var origin = AppUrls.FrontendOrigin(cfg);
        await email.SendAsync(address, "retention-warning", new Dictionary<string, string>
        {
            ["purgeDate"] = purgeDate.ToString("yyyy-MM-dd"),
            ["daysLeft"] = daysLeft.ToString(),
            ["billingUrl"] = $"{origin}/billing",
        }, ct);
    }
}
