namespace Spectr.Bff.DTOs;

public sealed record RegisterRequest(string Email, string Password);
public sealed record LoginRequest(string Email, string Password);
// Development-only one-click sign-in. Email optional (defaults to the dev account).
public sealed record DevLoginRequest(string? Email);
public sealed record AuthResponse(string AccessToken, AuthedUser User);
// Story 2.1 — Tier is "free" until a subscription with status ∈ {active,
// trialing} exists. Transitional field; story 2.4's Entitlements.For(user)
// resolver will widen this into a richer object.
public sealed record AuthedUser(
    Guid Id,
    string Email,
    string? DisplayName,
    string Tier);

// PATCH /api/auth/me. Null = leave unchanged. Empty string for DisplayName
// is treated as "clear it".
public sealed record PatchMeRequest(string? DisplayName);

// Story 4.3 — verification + reset flows (tokens are the emailed raw values).
public sealed record VerifyEmailRequest(string? Token);
public sealed record ForgotPasswordRequest(string? Email);
public sealed record ResetPasswordRequest(string? Token, string? NewPassword);
