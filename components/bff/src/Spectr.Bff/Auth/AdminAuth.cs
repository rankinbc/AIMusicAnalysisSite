using System.Security.Cryptography;
using System.Text;

namespace Spectr.Bff.Auth;

// Story 10.5 (NFR7) — the elevated-auth channel, deliberately SEPARATE from
// the user JWT pipeline: a static high-entropy key in the X-Admin-Key
// header, constant-time-compared. Unconfigured ⇒ every admin route 404s
// (the surface is invisible, not merely locked). Outside Development a
// configured key must be ≥32 chars (boot gate in Program.cs).
public static class AdminAuth
{
    public const string HeaderName = "X-Admin-Key";

    /// <summary>Endpoint filter for the /api/admin group.</summary>
    public static async ValueTask<object?> Filter(
        EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
    {
        var cfg = ctx.HttpContext.RequestServices.GetRequiredService<IConfiguration>();
        var expected = cfg["Admin:ApiKey"];
        if (string.IsNullOrWhiteSpace(expected))
            return Results.NotFound(); // surface hidden until configured

        var presented = ctx.HttpContext.Request.Headers[HeaderName].ToString();
        if (presented.Length == 0 || !FixedEquals(presented, expected))
            return Results.Unauthorized();

        return await next(ctx);
    }

    private static bool FixedEquals(string a, string b)
    {
        // Hash both sides first: fixed 32-byte comparison, no length branch
        // at all (review nicety — the length leak was negligible, the fix is
        // free).
        var ah = SHA256.HashData(Encoding.UTF8.GetBytes(a));
        var bh = SHA256.HashData(Encoding.UTF8.GetBytes(b));
        return CryptographicOperations.FixedTimeEquals(ah, bh);
    }
}
