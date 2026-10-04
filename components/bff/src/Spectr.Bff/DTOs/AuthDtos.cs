namespace Spectr.Bff.DTOs;

// F1 — optional first-touch attribution captured by the frontend at boot
// (lib/attribution.ts). Untrusted: SignupAttributionWriter re-sanitizes it.
// Trailing + defaulted so every existing caller and body keeps working.
public sealed record SignupAttribution(string? Source, string? Medium, string? Campaign, string? Referrer);
public sealed record RegisterRequest(string Email, string Password, SignupAttribution? Attribution = null);
// F1 — POST /auth/demo is normally body-less; when present the body is this.
public sealed record DemoStartRequest(SignupAttribution? Attribution = null);
public sealed record LoginRequest(string Email, string Password);
// Development-only one-click sign-in. Email optional (defaults to the dev account).
public sealed record DevLoginRequest(string? Email);
public sealed record AuthResponse(string AccessToken, AuthedUser User);
// Story 2.1 — Tier is "free" until a subscription with status ∈ {active,
// trialing} exists. Transitional field; story 2.4's Entitlements.For(user)
// resolver will widen this into a richer object.
// Task D5 — trailing IsGuest flag (defaulted so every existing positional
// caller keeps compiling without a fifth argument).
public sealed record AuthedUser(
    Guid Id,
    string Email,
    string? DisplayName,
    string Tier,
    bool IsGuest = false);

// Task G2 fix round 1 (item 3) — POST /api/auth/guest/convert's fallback
// body. The conversion UPDATE has already committed by the time this can be
// returned; a DB blip only in the post-UPDATE tail (refresh-row delete, new
// refresh issue, cookie write) must not turn a completed conversion into a
// 500. No tokens here — SessionIssued=false tells the caller no session was
// minted, so they sign in normally with the password they just set.
public sealed record GuestConversionFallback(bool SessionIssued, string Message);

// PATCH /api/auth/me. Null = leave unchanged. Empty string for DisplayName
// is treated as "clear it".
public sealed record PatchMeRequest(string? DisplayName);

// Verify-before-sign-in (2026-10) — 202 body of POST /auth/register and POST
// /auth/guest/convert when the account still needs its email verified: NO
// tokens, no refresh cookie. The frontend shows "Check your inbox" for
// `Email`. Identical for a brand-new address and a re-registration of a
// still-unverified one (no oracle between the two).
public sealed record VerificationPendingResponse(bool VerificationRequired, string Email);

// POST /auth/verify-email/resend (anonymous) — always the same 202.
public sealed record ResendVerificationRequest(string? Email);

// POST /auth/verify-email success: a normal signed-in session (refresh cookie
// set alongside) + whether a guest's work was just converted onto the account.
public sealed record VerifyEmailResponse(string AccessToken, AuthedUser User, bool Converted);

// Story 4.3 — verification + reset flows (tokens are the emailed raw values).
public sealed record VerifyEmailRequest(string? Token);
public sealed record ForgotPasswordRequest(string? Email);
public sealed record ResetPasswordRequest(string? Token, string? NewPassword);
