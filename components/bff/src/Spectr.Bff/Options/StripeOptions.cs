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
    // Credit economy — Stripe Price id per one-time pack, keyed by credit
    // count (env: Stripe__CreditPackPrices__500=price_…). Not secrets.
    public Dictionary<string, string> CreditPackPrices { get; init; } = new();
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

    // Story 2.3 — credit packs gate the /credits checkout + webhook
    // handler separately. A deployment that ships subscriptions only
    // (no credit packs yet) leaves these null; the /checkout/credits
    // endpoint returns `stripe_not_configured` 503. This keeps the two
    // monetization surfaces independently rolloutable.
    public string? PriceForPack(int credits)
        => CreditPackPrices.TryGetValue(credits.ToString(), out var id) && !string.IsNullOrWhiteSpace(id) ? id : null;

    public bool CreditPacksConfigured(IEnumerable<int> packCredits)
        => IsConfigured && packCredits.All(c => PriceForPack(c) is not null);
}
