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
    ILogger<RetentionSweepScheduler> logger,
    int guestPurgeBatchSize = 200,
    int guestPurgeMaxBatches = 50)
    : BackgroundService
{
    private static readonly string[] LapsedStatuses = ["canceled", "unpaid", "incomplete_expired"];
    private static readonly string[] PaidStatuses = ["active", "trialing", "past_due"];

    private readonly IServiceScopeFactory _scopeFactory = scopeFactory;
    private readonly IOptions<RetentionOptions> _options = options;
    private readonly ILogger<RetentionSweepScheduler> _logger = logger;
    private readonly int _guestPurgeBatchSize = guestPurgeBatchSize;
    private readonly int _guestPurgeMaxBatches = guestPurgeMaxBatches;

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
        // M2: the guest pass shares this ONE kill switch with the warning
        // emails and the authoritative-sweep enqueue below — there is no
        // separate "guest purge enabled" flag. With Retention:Enabled=false,
        // expired guest sandboxes are never purged by this process either.
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
        await PurgeExpiredGuestsAsync(DateTimeOffset.UtcNow, onlyUserIds: null, ct);
    }

    // internal test seam (InternalsVisibleTo). Batches so a backlog of
    // thousands of guests never holds one giant transaction. C1 fix: ids
    // already ATTEMPTED in this run (success or failure) are excluded from
    // the next batch's select — a guest whose teardown keeps throwing would
    // otherwise re-match the same predicate forever (stable OrderBy, no
    // cursor) and the run would never return. A hard cap on batches (default
    // 50) is a second backstop, and the loop also stops the moment a whole
    // batch produces zero successes (no forward progress left to make).
    // C2 fix: each GUEST gets its own DI scope (own AppDbContext), resolved
    // fresh right before that guest's teardown — never shared across guests
    // in a batch. A failed teardown's poisoned ChangeTracker (a committed
    // `Added` audit row the DbContext still thinks is pending, per a
    // mid-transaction throw) dies with that scope instead of leaking into
    // the next guest's SaveChanges.
    //
    // `onlyUserIds` is a TEST-ONLY narrowing filter (production always
    // passes null): it restricts the purge to ids the caller already knows
    // about instead of sweeping every expired guest in the shared dev DB.
    internal async Task<int> PurgeExpiredGuestsAsync(
        DateTimeOffset now, IReadOnlyCollection<Guid>? onlyUserIds, CancellationToken ct)
    {
        var purged = 0;
        var attempted = new HashSet<Guid>();

        for (var batchNum = 1; batchNum <= _guestPurgeMaxBatches; batchNum++)
        {
            if (ct.IsCancellationRequested) break;

            List<Guid> batchIds;
            using (var selectScope = _scopeFactory.CreateScope())
            {
                var db = selectScope.ServiceProvider.GetRequiredService<AppDbContext>();

                // Predicate lives in exactly ONE place, and it's a query on
                // IsGuest — never the email suffix. D5 ruling: a NULL
                // guest_expires_at on a guest row counts as expired (a stray
                // row from a failed seed must not live forever). A real
                // user can never match this (IsGuest is always false for
                // one), even if some inconsistent row happened to carry a
                // past guest_expires_at or a guest-looking email.
                var query = db.Users
                    .Where(u => u.IsGuest && (u.GuestExpiresAt == null || u.GuestExpiresAt < now));
                if (onlyUserIds is not null)
                    query = query.Where(u => onlyUserIds.Contains(u.Id));
                if (attempted.Count > 0)
                    query = query.Where(u => !attempted.Contains(u.Id));

                batchIds = await query
                    .OrderBy(u => u.CreatedAt)
                    .Take(_guestPurgeBatchSize)
                    .Select(u => u.Id)
                    .ToListAsync(ct);
            }

            if (batchIds.Count == 0) break;

            var successesThisBatch = 0;
            foreach (var id in batchIds)
            {
                attempted.Add(id);
                if (await PurgeOneGuestAsync(id, ct))
                {
                    purged++;
                    successesThisBatch++;
                }
            }

            // No forward progress in a full batch — every remaining
            // candidate just failed. Stop instead of re-selecting the same
            // (now attempted-excluded, so actually empty) set forever.
            if (successesThisBatch == 0) break;

            if (batchNum == _guestPurgeMaxBatches)
                _logger.LogWarning(
                    "Guest purge hit the {MaxBatches}-batch cap ({Attempted} guest(s) attempted this run); "
                    + "remaining expired guests are deferred to the next nightly run.",
                    _guestPurgeMaxBatches, attempted.Count);
        }

        if (purged > 0)
            _logger.LogInformation("Guest purge: {Count} expired guest sandbox(es) torn down.", purged);
        return purged;
    }

    // C2: a fresh DI scope (own AppDbContext, own IAccountTeardown, own
    // IJobQueue) per guest — see PurgeExpiredGuestsAsync's fix comment.
    // Returns true once the teardown has COMMITTED (M5 — a guest counts as
    // purged even if the follow-up enqueue below fails; the row is already
    // gone either way).
    private async Task<bool> PurgeOneGuestAsync(Guid userId, CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var teardown = scope.ServiceProvider.GetRequiredService<IAccountTeardown>();
        var queue = scope.ServiceProvider.GetRequiredService<IJobQueue>();

        try
        {
            var guest = await db.Users.SingleOrDefaultAsync(u => u.Id == userId, ct);
            if (guest is null) return false; // already gone (e.g. raced with another purge path)

            await teardown.TearDownAsync(guest, "guest_purge", "guest sandbox expired", ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Guest purge failed for {UserId} — left for the next nightly run.", userId);
            return false;
        }

        try
        {
            await queue.EnqueueAsync(
                DramatiqTasks.DeleteAccountData, [userId.ToString()], DramatiqQueues.Maintenance, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // M1: unlike the catch above, the teardown already COMMITTED —
            // there is no user row left for "the next nightly run" to find
            // and retry. Only the enqueue failed, so the account is gone
            // but its content (analyses, songs, etc.) is stranded until
            // something re-enqueues delete_account_data — same severity as
            // the account-deletion endpoint's equivalent failure.
            _logger.LogCritical(ex,
                "Guest {UserId} torn down but delete_account_data enqueue failed; content orphaned; "
                + "sweep_retention re-enqueues.", userId);
        }

        return true;
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
