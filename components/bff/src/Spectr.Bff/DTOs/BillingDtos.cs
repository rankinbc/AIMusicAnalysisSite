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
