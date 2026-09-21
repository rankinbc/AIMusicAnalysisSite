namespace Spectr.Bff.DTOs;

// Story 2.1 — billing wire shapes. Camel-cased on the wire via the global
// JsonSerializerDefaults.Web convention.

/// <summary>Frontend posts this to start the Stripe Checkout flow.</summary>
/// <param name="Cadence">"monthly" | "annual"</param>
public sealed record CreateCheckoutSessionRequest(string Cadence);

/// <summary>The hosted-checkout URL the frontend redirects to.</summary>
public sealed record CreateCheckoutSessionResponse(string Url, string SessionId);

/// <summary>
/// Public pricing display values for /api/billing/plans. Integer cents
/// per architecture line 96; the frontend renders these so the
/// no-price-literals lint (AR39) stays clean.
/// </summary>
public sealed record PlansResponse(
    int ProMonthlyCents,
    int ProAnnualCents,
    // Story 2.3 — credit-pack display cents so the BuyCreditsCard can
    // render prices via formatCents (AR39 no-literals lint).
    int CreditPack5Cents,
    int CreditPack10Cents,
    string Currency,
    // Task P2 (public-surfaces-polish D6) — true/false only when the
    // server actually resolved it; null means "unknown" (a failed flag
    // read), which logged-out callers must treat as hidden, not as off.
    bool? CreditsEnabled = null);

// ── Story 2.2 — manage-subscription self-service wire shapes ──────────

/// <summary>
/// Billing summary for the in-product /_app/billing page. Free users get
/// `Tier = "free"` with all subscription fields null; Pro users get the
/// full subscription snapshot. The frontend renders three states based
/// on (Tier, CancelAtPeriodEnd).
/// </summary>
public sealed record BillingSummaryDto(
    string Tier,                          // "free" | "pro"
    string? Status,                       // Stripe subscription status; null when Tier == "free"
    string? Cadence,                      // "monthly" | "annual" | "unknown"; null when Tier == "free"
    string? PriceId,
    DateTimeOffset? CurrentPeriodEnd,
    DateTimeOffset? CancelAt,
    bool CancelAtPeriodEnd,
    DateTimeOffset? NextChargeAt,         // null when CancelAt is set OR Tier == "free"
    int? NextChargeCents,                 // null when Tier == "free" or Cadence == "unknown"
    string? Currency,
    // Story 2.9 — Stripe retry date for an open dunning cycle. Non-null only
    // when Status == "past_due" and a retry is scheduled; drives the amber
    // DunningBanner "retrying {day}" copy (UX-DR33). Appended (defaulted) so
    // every existing positional construction stays valid.
    DateTimeOffset? RetryAt = null);

public sealed record CancelSubscriptionRequest(string? Reason);

public sealed record ChangeCadenceRequest(string Cadence);

public sealed record CreatePortalSessionResponse(string Url);

// ── Story 2.3 — credit packs + ledger wire shapes ────────────────────

/// <summary>
/// Frontend posts this to start a one-time credit-pack Checkout.
/// PackSize MUST be 5 or 10; any other value returns
/// `invalid_pack_size` 400.
/// </summary>
public sealed record BuyCreditsRequest(int PackSize);

/// <summary>
/// Single ledger row projected onto the wire. The frontend's mono
/// ledger table renders these directly.
/// </summary>
public sealed record CreditLedgerEntryDto(
    Guid Id,
    int Amount,
    string Reason,
    string? Reference,
    DateTimeOffset CreatedAt);

/// <summary>
/// GET /api/billing/credits response. Balance is SUM(amount) across the
/// user's ledger entries; entries is the most recent N rows in DESC
/// order. NextCursor is the ISO-8601 created_at of the last returned
/// row when more pages exist; null when the response is exhaustive.
/// </summary>
public sealed record CreditsResponse(
    int Balance,
    IReadOnlyList<CreditLedgerEntryDto> Entries,
    string? NextCursor);

// ── Story 2.4 — entitlement snapshot ─────────────────────────────────

/// <summary>
/// GET /api/me/entitlements — caller's current entitlement snapshot.
/// Null means unlimited (Pro tier). Cached 60 s server-side; staleTime
/// 30 s on the frontend so the client rarely needs a round-trip.
/// </summary>
public sealed record EntitlementsDto(
    int? AnalysesRemaining,
    int CoachRemaining,
    bool StemsEnabled,
    bool AlsEnabled,
    bool FullVerdictsEnabled,
    int? HistoryDepth,
    string Tier,
    // Story 2.7 — the period allotment + consumption behind AnalysesRemaining,
    // surfaced so the UpgradeSheet can render the "{used} of {limit} used this
    // month" header (UX-DR30). AnalysesLimit is null when unlimited (Pro/credits);
    // the free cap comes from the free_analyses_per_month flag (AR35, never hardcoded).
    int? AnalysesLimit = null,
    int AnalysesUsed = 0,
    // Story 2.8 — the usage page (UX-DR31/UX-DR32) needs the coach pool snapshot
    // and the analyses reset instant so it can render the
    // "{used} of {limit} · resets {date}" caps grammar (UX-DR16) without any
    // tier/date math on the client (AR35). `Coach` reuses the CoachCapsDto shape
    // (scope ∈ analysis|month|unlimited). `AnalysesResetsAt` = first-of-next-month
    // UTC on the free tier; null when analyses are unlimited (Pro/credits). Both
    // additive — older clients ignore them.
    CoachCapsDto? Coach = null,
    DateTimeOffset? AnalysesResetsAt = null,
    // credits_enabled feature flag mirror. When false the credit system is
    // switched off — everyone resolves as premium/unlimited — and the frontend
    // hides billing/tier UI (buy-credits, upgrade CTAs, tier chips, meters).
    bool CreditsEnabled = true);

// ── Story 2.8 — usage-page honest math ───────────────────────────────
/// <summary>
/// GET /api/me/honest-math — the 90-day "credits vs Pro" comparison behind
/// the dismissible HonestMathBanner (UX-DR32). `Qualifies` is true only when
/// the user has spent at least the Pro-equivalent on credit packs in the
/// window, so the frontend keys the banner off a single server-computed flag.
/// All cents from config (AR39): `ProEquivalentCents` = PeriodDays/30 months of
/// `PricingDisplay.ProMonthlyCents`. `CreditsSpentCents` sums the window's
/// credit-PURCHASE ledger rows mapped to their pack display prices.
/// </summary>
public sealed record HonestMathDto(
    bool Qualifies,
    int CreditsSpentCents,
    int ProEquivalentCents,
    int PeriodDays,
    string Currency);
