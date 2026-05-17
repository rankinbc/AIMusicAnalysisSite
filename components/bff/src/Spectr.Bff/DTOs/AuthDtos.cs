namespace Spectr.Bff.DTOs;

public sealed record RegisterRequest(string Email, string Password);
public sealed record LoginRequest(string Email, string Password);
public sealed record AuthResponse(string AccessToken, AuthedUser User);
public sealed record AuthedUser(Guid Id, string Email, string? Handle, string? DisplayName);

// PATCH /api/auth/me. Null = leave unchanged. Empty string for DisplayName
// is treated as "clear it"; Handle has no clearing path (must always be set).
public sealed record PatchMeRequest(string? DisplayName, string? Handle);
