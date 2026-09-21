using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;

namespace Spectr.Bff.Auth;

public static class ClaimsPrincipalExtensions
{
    public static Guid UserId(this ClaimsPrincipal p)
    {
        var sub = p.FindFirstValue(JwtRegisteredClaimNames.Sub)
                  ?? p.FindFirstValue(ClaimTypes.NameIdentifier);
        if (sub is null) throw new InvalidOperationException("Missing sub claim on principal.");
        return Guid.Parse(sub);
    }

    public static string? Email(this ClaimsPrincipal p) =>
        p.FindFirstValue(JwtRegisteredClaimNames.Email)
        ?? p.FindFirstValue(ClaimTypes.Email);

    // Task D5/D3 — the in-process spectr_guest claim GuestIdentity.Mark adds
    // during OnTokenValidated (never carried on the signed JWT itself).
    public static bool IsGuest(this ClaimsPrincipal p) => p.HasClaim(GuestIdentity.ClaimType, "1");
}
