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
    public int ProMonthlyCents { get; init; } = 1299;
    public int ProAnnualCents { get; init; } = 9900;
    // Story 2.3 — credit pack display cents per UX-DR32 (5-pack / 10-pack).
    // Source of truth for the BILLED amount is the Stripe Price object
    // referenced by StripeOptions.PriceCreditPack5 / .PriceCreditPack10;
    // story 2.10's reconciliation alerts on drift.
    public int CreditPack5Cents { get; init; } = 1900;
    public int CreditPack10Cents { get; init; } = 3500;
    public string Currency { get; init; } = "USD";
}
