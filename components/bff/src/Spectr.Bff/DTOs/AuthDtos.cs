namespace Spectr.Bff.DTOs;

public sealed record RegisterRequest(string Email, string Password);
public sealed record LoginRequest(string Email, string Password);
public sealed record AuthResponse(string AccessToken, AuthedUser User);
// Story 2.1 — Tier is "free" until a subscription with status ∈ {active,
// trialing} exists. Transitional field; story 2.4's Entitlements.For(user)
// resolver will widen this into a richer object.
public sealed record AuthedUser(
    Guid Id,
    string Email,
    string? Handle,
    string? DisplayName,
    string Tier);

// PATCH /api/auth/me. Null = leave unchanged. Empty string for DisplayName
// is treated as "clear it"; Handle has no clearing path (must always be set).
public sealed record PatchMeRequest(string? DisplayName, string? Handle);
