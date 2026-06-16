namespace Spectr.Bff.Options;

// Story 2.1 / D2 — Stripe SDK configuration. SecretKey + WebhookSecret are
// real secrets and must come from `dotnet user-secrets` in dev / env vars
// in prod — NEVER from appsettings.json (NFR6). PriceProMonthly and
// PriceProAnnual are NOT secrets (Stripe Price IDs are designed for
// client-side embedding) but still travel through config so dev/stage/prod
// can rotate price tiers without code changes.
//
// SuccessUrl + CancelUrl default to dev origins; prod overrides via env.

public sealed class StripeOptions
{
    public const string SectionName = "Stripe";

    public string? SecretKey { get; init; }
    public string? WebhookSecret { get; init; }
    public string? PriceProMonthly { get; init; }
    public string? PriceProAnnual { get; init; }
    public string SuccessUrl { get; init; } = "http://localhost:5174/billing/success?session_id={CHECKOUT_SESSION_ID}";
    public string CancelUrl { get; init; } = "http://localhost:5174/billing/cancelled";

    // Story 2.2 review-fix P2 — Customer Portal landing URL. Used as the
    // `ReturnUrl` on Stripe portal sessions so users land back on the
    // self-service billing page (not the checkout-success route). Kept
    // separate from SuccessUrl so dev/stage/prod can rotate independently.
    public string PortalReturnUrl { get; init; } = "http://localhost:5174/billing";

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(SecretKey)
        && !string.IsNullOrWhiteSpace(WebhookSecret)
        && !string.IsNullOrWhiteSpace(PriceProMonthly)
        && !string.IsNullOrWhiteSpace(PriceProAnnual);
}
