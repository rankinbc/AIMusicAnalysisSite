using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Spectr.Bff.Options;
using Spectr.Bff.Services;
using Stripe;
using StripeBillingPortalSession = Stripe.BillingPortal.Session;
using StripeBillingPortalSessionCreateOptions = Stripe.BillingPortal.SessionCreateOptions;
using StripeSubscription = Stripe.Subscription;
using SubscriptionEntity = Spectr.Data.Entities.Subscription;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 2.10 / AC1 / AC4 — unit tests for BillingReconciliationService.
//
// These are pure unit tests: no WebApplicationFactory, no Postgres.
// BillingReconciliationService.CheckPriceDisplayAsync and RunReconciliationAsync
// are internal, accessible via InternalsVisibleTo("Spectr.Bff.Tests").
//
// For AC4 integer-cents structural guarantee: the credit_ledger.amount column
// is `int` in EF (enforced by schema + CHECK amount <> 0 constraint in
// migration 20260616031132). No runtime assertion is needed here — it is
// structural. We test the price-display drift-detection half of AC4.
public sealed class BillingReconciliationServiceTests
{
    // ── Hand-rolled fakes (no mocking library in the project) ─────────────

    private sealed class FakeStripeClient : IStripeSubscriptionClient
    {
        public Price? PriceResult { get; set; }
        public Stripe.Subscription? SubscriptionResult { get; set; }

        public Task<Stripe.Subscription?> GetSubscriptionAsync(string subscriptionId, CancellationToken ct)
            => Task.FromResult(SubscriptionResult);

        public Task<Price?> GetPriceAsync(string priceId, CancellationToken ct)
            => Task.FromResult(PriceResult);

        // Unused write paths.
        public Task<Stripe.Subscription> UpdateAsync(string subscriptionId, SubscriptionUpdateOptions options, string idempotencyKey, CancellationToken ct)
            => throw new NotImplementedException();

        public Task<StripeBillingPortalSession> CreatePortalSessionAsync(StripeBillingPortalSessionCreateOptions options, string idempotencyKey, CancellationToken ct)
            => throw new NotImplementedException();
    }

    // Scope factory that must NOT be called — validates the skip-when-
    // unconfigured path never touches the DB.
    private sealed class NeverCallScopeFactory : IServiceScopeFactory
    {
        public IServiceScope CreateScope()
            => throw new InvalidOperationException("CreateScope must not be called when Stripe is not configured.");
    }

    // Captures log entries for assertion.
    private sealed class CapturingLogger : ILogger<BillingReconciliationService>
    {
        private readonly List<(LogLevel Level, string Message)> _entries = [];
        public IReadOnlyList<(LogLevel Level, string Message)> Entries => _entries;

        public bool HasWarning(string fragment)
            => _entries.Any(e => e.Level == LogLevel.Warning && e.Message.Contains(fragment));

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
            => _entries.Add((logLevel, formatter(state, exception)));
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    private static (BillingReconciliationService Svc, CapturingLogger Logger) Build(
        IStripeSubscriptionClient stripe,
        StripeOptions stripeOpts,
        PricingDisplayOptions pricingOpts,
        IServiceScopeFactory? scopeFactory = null)
    {
        var logger = new CapturingLogger();
        var svc = new BillingReconciliationService(
            scopeFactory ?? new NeverCallScopeFactory(),
            Microsoft.Extensions.Options.Options.Create(stripeOpts),
            Microsoft.Extensions.Options.Options.Create(pricingOpts),
            logger);
        return (svc, logger);
    }

    private static StripeOptions ConfiguredStripe() => new()
    {
        SecretKey = "sk_test_unit",
        WebhookSecret = "whsec_unit",
        PriceProMonthly = "price_monthly_unit",
        PriceProAnnual = "price_annual_unit",
    };

    // ── Tests ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task RunReconciliation_DetectsCurrencyMismatch()
    {
        // Stripe returns EUR; display config says USD.
        var fake = new FakeStripeClient
        {
            PriceResult = new Price { Currency = "eur", UnitAmount = 1299L },
        };
        var pricingOpts = new PricingDisplayOptions
        {
            Currency = "USD",
            ProMonthlyCents = 1299,
            ProAnnualCents = 9900,
            CreditPack5Cents = 1900,
            CreditPack10Cents = 3500,
        };

        var (svc, logger) = Build(fake, ConfiguredStripe(), pricingOpts);

        await svc.CheckPriceDisplayAsync(fake, CancellationToken.None);

        Assert.True(logger.HasWarning("ReconciliationDrift:PriceCurrencyMismatch"),
            "Expected a currency-mismatch drift warning.");
    }

    [Fact]
    public async Task RunReconciliation_DetectsAmountMismatch()
    {
        // Stripe returns 999 cents; display config expects 1299.
        var fake = new FakeStripeClient
        {
            PriceResult = new Price { Currency = "usd", UnitAmount = 999L },
        };
        var pricingOpts = new PricingDisplayOptions
        {
            Currency = "USD",
            ProMonthlyCents = 1299,
            ProAnnualCents = 9900,
            CreditPack5Cents = 1900,
            CreditPack10Cents = 3500,
        };

        var (svc, logger) = Build(fake, ConfiguredStripe(), pricingOpts);

        await svc.CheckPriceDisplayAsync(fake, CancellationToken.None);

        Assert.True(logger.HasWarning("ReconciliationDrift:PriceAmountMismatch"),
            "Expected an amount-mismatch drift warning.");
        Assert.False(logger.HasWarning("ReconciliationDrift:PriceCurrencyMismatch"),
            "Currency comparison is case-insensitive; usd vs USD must not warn.");
    }

    [Fact]
    public async Task RunReconciliation_SkipsWhenStripeNotConfigured()
    {
        // IsConfigured == false when SecretKey is absent.
        var unconfiguredStripe = new StripeOptions();
        Assert.False(unconfiguredStripe.IsConfigured);

        var fake = new FakeStripeClient();
        var (svc, logger) = Build(
            fake,
            unconfiguredStripe,
            new PricingDisplayOptions(),
            // NeverCallScopeFactory is the default; asserts CreateScope is
            // never called when Stripe is not configured.
            scopeFactory: null);

        // RunReconciliationAsync (not CheckPriceDisplayAsync) so we exercise
        // the early-exit guard at the top of the full reconciliation flow.
        await svc.RunReconciliationAsync(CancellationToken.None);

        Assert.DoesNotContain(logger.Entries, e => e.Level == LogLevel.Warning);
    }

    // ── Subscription-mirror drift (review-fix P3 — was untested) ───────────

    private static SubscriptionEntity LocalSub(
        string status = "active",
        string priceId = "price_monthly_unit",
        DateTimeOffset? periodEnd = null)
        => new()
        {
            UserId = Guid.NewGuid(),
            StripeCustomerId = "cus_x",
            StripeSubscriptionId = "sub_x",
            Status = status,
            PriceId = priceId,
            CurrentPeriodEnd = periodEnd ?? DateTimeOffset.UtcNow.AddDays(15),
        };

    private static StripeSubscription StripeSub(
        string status = "active",
        string priceId = "price_monthly_unit",
        DateTime? periodEnd = null)
        => new()
        {
            Id = "sub_x",
            Status = status,
            Items = new StripeList<SubscriptionItem>
            {
                Data =
                [
                    new SubscriptionItem
                    {
                        Price = new Price { Id = priceId },
                        CurrentPeriodEnd = periodEnd ?? DateTime.UtcNow.AddDays(15),
                    },
                ],
            },
        };

    [Fact]
    public void CheckSubscriptionDrift_DetectsStatusMismatch()
    {
        var fake = new FakeStripeClient();
        var (svc, logger) = Build(fake, ConfiguredStripe(), new PricingDisplayOptions());

        svc.CheckSubscriptionDrift(
            LocalSub(status: "active"),
            StripeSub(status: "past_due"));

        Assert.True(logger.HasWarning("ReconciliationDrift:Subscription"),
            "Expected a status-drift warning.");
        Assert.Contains(logger.Entries,
            e => e.Level == LogLevel.Warning && e.Message.Contains("field=Status"));
    }

    [Fact]
    public void CheckSubscriptionDrift_DetectsPriceIdMismatch()
    {
        var fake = new FakeStripeClient();
        var (svc, logger) = Build(fake, ConfiguredStripe(), new PricingDisplayOptions());

        svc.CheckSubscriptionDrift(
            LocalSub(priceId: "price_old"),
            StripeSub(priceId: "price_new"));

        Assert.Contains(logger.Entries,
            e => e.Level == LogLevel.Warning && e.Message.Contains("field=PriceId"));
    }

    [Fact]
    public void CheckSubscriptionDrift_NoDrift_WhenAllFieldsMatch()
    {
        var fake = new FakeStripeClient();
        var (svc, logger) = Build(fake, ConfiguredStripe(), new PricingDisplayOptions());

        var end = DateTimeOffset.UtcNow.AddDays(20);
        svc.CheckSubscriptionDrift(
            LocalSub(status: "active", priceId: "price_x", periodEnd: end),
            // Same instant (within tolerance) for period end.
            StripeSub(status: "active", priceId: "price_x", periodEnd: end.UtcDateTime));

        Assert.DoesNotContain(logger.Entries, e => e.Level == LogLevel.Warning);
    }

    [Fact]
    public void CheckSubscriptionDrift_SkipsPeriodEnd_ForFarFutureSentinel()
    {
        // review-fix P1: a mirror row carrying the AddYears(10) sentinel
        // (dropped current_period_end webhook) must NOT emit perpetual
        // CurrentPeriodEnd drift. Status + price match, so the ONLY possible
        // warning would be the period-end one — assert there is none.
        var fake = new FakeStripeClient();
        var (svc, logger) = Build(fake, ConfiguredStripe(), new PricingDisplayOptions());

        svc.CheckSubscriptionDrift(
            LocalSub(periodEnd: DateTimeOffset.UtcNow.AddYears(10)),
            StripeSub(periodEnd: DateTime.UtcNow.AddDays(15)));

        Assert.DoesNotContain(logger.Entries,
            e => e.Level == LogLevel.Warning && e.Message.Contains("field=CurrentPeriodEnd"));
    }

    [Fact]
    public void CheckSubscriptionDrift_DetectsPeriodEndDrift_BeyondTolerance()
    {
        var fake = new FakeStripeClient();
        var (svc, logger) = Build(fake, ConfiguredStripe(), new PricingDisplayOptions());

        var localEnd = DateTimeOffset.UtcNow.AddDays(20);
        svc.CheckSubscriptionDrift(
            LocalSub(periodEnd: localEnd),
            // 1 hour off — well beyond the 5-minute tolerance.
            StripeSub(periodEnd: localEnd.UtcDateTime.AddHours(1)));

        Assert.Contains(logger.Entries,
            e => e.Level == LogLevel.Warning && e.Message.Contains("field=CurrentPeriodEnd"));
    }
}
