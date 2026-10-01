namespace Spectr.Bff.Options;

// Story 2.1 / AR39 — pricing display values for the public /pricing page.
// Frontend renders these via GET /api/billing/plans so the no-price-literals
// lint stays clean (no $ literals outside config). The source of truth for
// the ACTUAL billed amount is Stripe (the Price object referenced by
// StripeOptions.PriceProMonthly / .PriceProAnnual); these display values
// must be kept in lockstep with the dashboard, but the reconciliation job
// (story 2.10) will alert on drift.
//
// Integer cents per architecture line 96 ("integer cents everywhere").

public sealed class PricingDisplayOptions
{
    public const string SectionName = "PricingDisplay";

    // review-fix P23 — comments dropped; the integers are self-describing
    // (1299 cents = 12.99 in any cent-based currency). Keeping the inline
    // currency literal would be a copy-paste trap if these definitions
    // ever migrate to a non-Options file (the price-literal lint exempts
    // *Options.cs and would suddenly fire elsewhere).
    public int ProMonthlyCents { get; init; } = 799;
    public int ProAnnualCents { get; init; } = 7900;
    // Credit economy (2026-10-01) — one-time credit packs (display cents). The
    // BILLED amount is the Stripe Price in StripeOptions.CreditPackPrices[credits];
    // BillingReconciliationService alerts on drift.
    // Empty by default ON PURPOSE: the configuration binder APPENDS to a
    // pre-populated list, so configuring one pack would have yielded the three
    // defaults plus the configured one. Defaults are applied after binding,
    // only when nothing is configured (see ApplyDefaultCreditPacks).
    public List<CreditPackOption> CreditPacks { get; set; } = [];

    public static readonly IReadOnlyList<CreditPackOption> DefaultCreditPacks =
    [
        new() { Credits = 500, Cents = 400 },
        new() { Credits = 1500, Cents = 1000 },
        new() { Credits = 5000, Cents = 3000 },
    ];

    // Configured packs REPLACE the defaults; none configured ⇒ the defaults.
    public static void ApplyDefaultCreditPacks(PricingDisplayOptions o)
    {
        if (o.CreditPacks.Count == 0) o.CreditPacks = [.. DefaultCreditPacks];
    }
    public string Currency { get; init; } = "USD";
}

public sealed class CreditPackOption
{
    public int Credits { get; init; }
    public int Cents { get; init; }
}
