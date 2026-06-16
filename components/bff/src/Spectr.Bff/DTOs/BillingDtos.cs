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
public sealed record PlansResponse(int ProMonthlyCents, int ProAnnualCents, string Currency);

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
