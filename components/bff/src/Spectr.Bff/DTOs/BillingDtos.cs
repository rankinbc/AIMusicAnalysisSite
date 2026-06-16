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
    string Currency);

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
    string? Currency);

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
    string Tier);
