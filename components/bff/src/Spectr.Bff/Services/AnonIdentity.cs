using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using Spectr.Bff.Options;

namespace Spectr.Bff.Services;

/// <summary>
/// Durable, signed anonymous identity (stateless — no table). The
/// <see cref="AnonIdentityMiddleware"/> resolves a stable <see cref="AnonId"/> per
/// request (from the <c>spectr_anon</c> cookie, minting + signing a fresh one when
/// absent/forged). This replaces the non-durable ip_hash for new anon-capable
/// tables (PRP-2 G2, PRP-6 G1). Best-effort: clearing cookies mints a new anonId,
/// so anon ABUSE control rate-limits on ip too (see <c>IRateLimiter</c>).
/// </summary>
public sealed class AnonIdentity
{
    internal const string CookieName = "spectr_anon";
    private const int MaxDisplayName = 120;

    /// <summary>The resolved anonId for this request, set by the middleware. Null
    /// only when the request is authenticated and carries no prior anon cookie.</summary>
    public string? AnonId { get; internal set; }

    /// <summary>
    /// Capture an anon <see cref="ActorRef"/> for attribution. The helper PRP-3/6
    /// reference — returns an anonId (not an ip_hash) + a trimmed display name.
    /// </summary>
    public ActorRef Capture(string? displayName = null)
    {
        if (string.IsNullOrEmpty(AnonId))
        {
            throw new InvalidOperationException(
                "AnonIdentity not resolved — is app.UseAnonIdentity() registered before routing?");
        }
        var name = string.IsNullOrWhiteSpace(displayName) ? null : displayName.Trim();
        if (name is { Length: > MaxDisplayName }) name = name[..MaxDisplayName];
        return ActorRef.Anon(AnonId, name);
    }

    // ── Cookie value = "{anonId}.{hex(HMAC_SHA256(anonId))}" ───────────────────
    internal static string Sign(string anonId, string key)
    {
        var sig = Hmac(anonId, key);
        return $"{anonId}.{Convert.ToHexString(sig)}";
    }

    /// <summary>Verify a cookie value; returns the anonId if the HMAC matches, else null.</summary>
    internal static string? Verify(string? cookie, string key)
    {
        if (string.IsNullOrEmpty(cookie)) return null;
        var dot = cookie.LastIndexOf('.');
        if (dot <= 0 || dot >= cookie.Length - 1) return null;
        var anonId = cookie[..dot];
        var providedHex = cookie[(dot + 1)..];
        byte[] provided;
        try { provided = Convert.FromHexString(providedHex); }
        catch (FormatException) { return null; }
        var expected = Hmac(anonId, key);
        return CryptographicOperations.FixedTimeEquals(provided, expected) ? anonId : null;
    }

    private static byte[] Hmac(string anonId, string key)
    {
        using var h = new HMACSHA256(Encoding.UTF8.GetBytes(key));
        return h.ComputeHash(Encoding.UTF8.GetBytes(anonId));
    }
}

/// <summary>
/// Resolves <see cref="AnonIdentity.AnonId"/> for each request: verifies the signed
/// <c>spectr_anon</c> cookie, or — for an UNauthenticated request with no valid
/// cookie — mints a fresh signed one (Set-Cookie). Authenticated requests without a
/// prior anon cookie are left with a null anonId (they have a real identity).
/// Must run AFTER UseAuthentication (so the principal is known) and BEFORE routing.
/// </summary>
public sealed class AnonIdentityMiddleware
{
    private readonly RequestDelegate _next;
    private readonly string _key;

    public AnonIdentityMiddleware(RequestDelegate next, IOptions<AnonOptions> opts)
    {
        _next = next;
        _key = opts.Value.SigningKey
            ?? throw new InvalidOperationException(
                "Missing Anon:SigningKey — required to sign the durable anon cookie.");
    }

    public async Task Invoke(HttpContext ctx, AnonIdentity anon)
    {
        var anonId = AnonIdentity.Verify(ctx.Request.Cookies[AnonIdentity.CookieName], _key);
        var authed = ctx.User.Identity?.IsAuthenticated ?? false;

        if (anonId is null && !authed)
        {
            anonId = Guid.NewGuid().ToString("N");
            ctx.Response.Cookies.Append(
                AnonIdentity.CookieName,
                AnonIdentity.Sign(anonId, _key),
                new CookieOptions
                {
                    HttpOnly = true,
                    Secure = true,
                    SameSite = SameSiteMode.Lax,
                    Path = "/",
                    Expires = DateTimeOffset.UtcNow.AddYears(1),
                });
        }

        anon.AnonId = anonId;
        await _next(ctx);
    }
}

public static class AnonIdentityMiddlewareExtensions
{
    public static IApplicationBuilder UseAnonIdentity(this IApplicationBuilder app) =>
        app.UseMiddleware<AnonIdentityMiddleware>();
}
