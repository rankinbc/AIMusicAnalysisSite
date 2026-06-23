using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Spectr.Bff.Options;
using Spectr.Data;
using StripeSubscription = Stripe.Subscription;
using SubscriptionEntity = Spectr.Data.Entities.Subscription;

namespace Spectr.Bff.Services;

// Story 2.10 / AR14 / NFR14 / FR35 — nightly read-only drift check.
// Compares the local `subscriptions` mirror and `PricingDisplayOptions`
// against Stripe's canonical state. Never writes to the DB. Any drift
// is emitted as a structured-log warning with a `ReconciliationDrift:`
// prefix so Epic 10's observability story can define a single alert rule.
//
// Idempotency is structural: pure reads, no side effects. Running it
// twice produces the same warnings and nothing else.
//
// BackgroundService is singleton-lifetime. AppDbContext is scoped.
// All DB access goes through a freshly-created scope via IServiceScopeFactory
// so we never capture a stale scoped context.
internal sealed class BillingReconciliationService(
    IServiceScopeFactory scopeFactory,
    IOptions<StripeOptions> stripeOpts,
    IOptions<PricingDisplayOptions> pricingOpts,
    ILogger<BillingReconciliationService> logger)
    : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory = scopeFactory;
    private readonly IOptions<StripeOptions> _stripeOpts = stripeOpts;
    private readonly IOptions<PricingDisplayOptions> _pricingOpts = pricingOpts;
    private readonly ILogger<BillingReconciliationService> _logger = logger;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Review-fix P2: PeriodicTimer does NOT fire immediately — the first
        // WaitForNextTickAsync waits a full period. So we run once at startup
        // (do-while), then every 24 h. Without the initial run, a frequently
        // redeployed host would reset the 24 h clock on every restart and the
        // nightly drift check could rarely run. WaitForNextTickAsync returns
        // false (not throws) on cancellation, so the loop exits cleanly on
        // host shutdown.
        using var timer = new PeriodicTimer(TimeSpan.FromHours(24));
        do
        {
            try
            {
                await RunReconciliationAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "Reconciliation run failed.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    // internal — visible to Spectr.Bff.Tests via InternalsVisibleTo for
    // unit tests that call it directly without starting the 24-h timer.
    internal async Task RunReconciliationAsync(CancellationToken ct)
    {
        if (!_stripeOpts.Value.IsConfigured)
        {
            _logger.LogInformation("Stripe not configured; skipping reconciliation.");
            return;
        }

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var stripe = scope.ServiceProvider.GetRequiredService<IStripeSubscriptionClient>();

        var subs = await db.Subscriptions
            .AsNoTracking()
            .Where(s => s.StripeSubscriptionId != null)
            .ToListAsync(ct);

        foreach (var local in subs)
        {
            // Review-fix P4: a single Stripe error (429, network, api_error)
            // on one subscription must not abort the whole nightly run.
            // resource_missing is already swallowed (→ null) inside the client;
            // any OTHER fault is logged per-row and the loop continues so the
            // remaining subscriptions are still checked this run.
            try
            {
                var stripeSub = await stripe.GetSubscriptionAsync(local.StripeSubscriptionId, ct);
                if (stripeSub is null)
                {
                    _logger.LogWarning(
                        "ReconciliationDrift:SubscriptionMissing stripe_subscription_id={Id}",
                        local.StripeSubscriptionId);
                    continue;
                }

                CheckSubscriptionDrift(local, stripeSub);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex,
                    "Reconciliation: failed to check subscription {Id}; continuing.",
                    local.StripeSubscriptionId);
            }
        }

        await CheckPriceDisplayAsync(stripe, ct);

        _logger.LogInformation(
            "Reconciliation run complete. Subscriptions checked: {Count}", subs.Count);
    }

    // internal — exercises the per-subscription drift comparison without a DB.
    // Logs a `ReconciliationDrift:Subscription` warning per drifted field.
    internal void CheckSubscriptionDrift(SubscriptionEntity local, StripeSubscription stripeSub)
    {
        if (!string.Equals(local.Status, stripeSub.Status, StringComparison.Ordinal))
        {
            _logger.LogWarning(
                "ReconciliationDrift:Subscription field={Field} local={Local} stripe={Stripe} subscriptionId={SubId}",
                "Status", local.Status, stripeSub.Status, local.StripeSubscriptionId);
        }

        // Stripe.net 52.x: price + period_end live on SubscriptionItem.
        var firstItem = stripeSub.Items?.Data?.FirstOrDefault();
        var stripeItemPriceId = firstItem?.Price?.Id;
        if (stripeItemPriceId is not null
            && !string.Equals(local.PriceId, stripeItemPriceId, StringComparison.Ordinal))
        {
            _logger.LogWarning(
                "ReconciliationDrift:Subscription field={Field} local={Local} stripe={Stripe} subscriptionId={SubId}",
                "PriceId", local.PriceId, stripeItemPriceId, local.StripeSubscriptionId);
        }

        // Review-fix P1: SubscriptionMirrorService writes a far-future sentinel
        // (UtcNow.AddYears(10)) when a webhook drops current_period_end. That
        // sentinel is NOT real drift — comparing it to Stripe's actual end would
        // exceed the tolerance by years and emit a perpetual nightly false
        // positive that a read-only job can never self-heal. Skip the period-end
        // check for rows still carrying the sentinel (>5 yrs out); the next
        // item-bearing webhook replaces it with the canonical value.
        if (local.CurrentPeriodEnd > DateTimeOffset.UtcNow.AddYears(5))
        {
            return;
        }

        // CurrentPeriodEnd: 5-min tolerance for async webhook delivery lag.
        var stripeEndRaw = firstItem?.CurrentPeriodEnd;
        if (stripeEndRaw is DateTime rawDt && rawDt != default)
        {
            var stripeEnd = new DateTimeOffset(rawDt, TimeSpan.Zero);
            if (Math.Abs((local.CurrentPeriodEnd - stripeEnd).TotalMinutes) > 5)
            {
                _logger.LogWarning(
                    "ReconciliationDrift:Subscription field={Field} local={Local} stripe={Stripe} subscriptionId={SubId}",
                    "CurrentPeriodEnd", local.CurrentPeriodEnd, stripeEnd, local.StripeSubscriptionId);
            }
        }
    }

    // internal — called directly from unit tests to exercise price drift
    // logic without needing a DB connection.
    internal async Task CheckPriceDisplayAsync(IStripeSubscriptionClient stripe, CancellationToken ct)
    {
        var opts = _stripeOpts.Value;
        var display = _pricingOpts.Value;

        var pairs = new[]
        {
            (PriceId: opts.PriceProMonthly,     DisplayCents: display.ProMonthlyCents),
            (PriceId: opts.PriceProAnnual,       DisplayCents: display.ProAnnualCents),
            (PriceId: opts.PriceCreditPack5,     DisplayCents: display.CreditPack5Cents),
            (PriceId: opts.PriceCreditPack10,    DisplayCents: display.CreditPack10Cents),
        };

        foreach (var (priceId, displayCents) in pairs)
        {
            if (priceId is null) continue;

            var price = await stripe.GetPriceAsync(priceId, ct);
            if (price is null) continue;

            if (!string.Equals(price.Currency, display.Currency, StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogWarning(
                    "ReconciliationDrift:PriceCurrencyMismatch priceId={PriceId} stripeCurrency={Stripe} displayCurrency={Display}",
                    priceId, price.Currency, display.Currency);
            }

            // UnitAmount is long? — null for usage-based pricing. Skip if null.
            if (price.UnitAmount is long stripeAmountLong)
            {
                var stripeAmountCents = (int)stripeAmountLong;
                if (stripeAmountCents != displayCents)
                {
                    _logger.LogWarning(
                        "ReconciliationDrift:PriceAmountMismatch priceId={PriceId} stripeAmountCents={Stripe} displayCents={Display}",
                        priceId, stripeAmountCents, displayCents);
                }
            }
        }
    }
}
