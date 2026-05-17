namespace Spectr.Bff.DTOs;

public sealed record RegisterRequest(string Email, string Password);
public sealed record LoginRequest(string Email, string Password);
public sealed record AuthResponse(string AccessToken, AuthedUser User);
public sealed record AuthedUser(Guid Id, string Email, string? Handle, string? DisplayName);
