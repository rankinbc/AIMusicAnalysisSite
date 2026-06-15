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

    public int ProMonthlyCents { get; init; } = 1299;   // $12.99
    public int ProAnnualCents { get; init; } = 9900;    // $99.00
    public string Currency { get; init; } = "USD";
}
