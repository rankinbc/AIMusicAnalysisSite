using System.Security.Claims;

namespace Spectr.Bff.Auth;

// Task D5 — guest demo sandbox. Everything the rest of the BFF needs to know
// "is this request a guest" or "mint a guest" lives here so it isn't
// duplicated between DemoAuthEndpoints, AuthEndpoints' guard edits, and
// Program.cs's OnTokenValidated widening (spec D1/D2/D3).
public static class GuestIdentity
{
    // RFC 2606 reserved TLD — no mail can ever be delivered, no real person
    // can register this domain (Register rejects it explicitly).
    public const string EmailDomain = "guest.spectr.invalid";

    // In-process claim only (never signed into the JWT) — Program.cs adds it
    // after OnTokenValidated confirms guest status via the tver: snapshot OR
    // the email-suffix fallback (D3).
    public const string ClaimType = "spectr_guest";

    public static string EmailFor(Guid id) => $"guest-{id:N}@{EmailDomain}";

    public static bool IsGuestEmail(string? email) =>
        !string.IsNullOrEmpty(email)
        && email.EndsWith("@" + EmailDomain, StringComparison.OrdinalIgnoreCase);

    public static void Mark(ClaimsPrincipal p)
    {
        var identity = p.Identities.FirstOrDefault();
        if (identity is null) return;
        if (!identity.HasClaim(ClaimType, "1")) identity.AddClaim(new Claim(ClaimType, "1"));
    }

    // ONE process-wide bcrypt hash of a random secret nobody knows (D1).
    // Computed lazily on first use, never per request — bcrypt costs ~250ms
    // and every guest shares the same unknowable password. A real hash is
    // required: BCrypt.Verify throws on a malformed one.
    private static Lazy<string>? _sharedHash;

    public static string SharedPasswordHash(PasswordHasher hasher)
    {
        // LazyInitializer guards the ONE-TIME assignment of the Lazy<T>
        // reference itself; Lazy<T>'s own default mode (ExecutionAndPublication)
        // then guarantees the hash factory runs exactly once even under
        // concurrent first callers.
        System.Threading.LazyInitializer.EnsureInitialized(ref _sharedHash, () =>
            new Lazy<string>(() => hasher.Hash(Convert.ToBase64String(
                System.Security.Cryptography.RandomNumberGenerator.GetBytes(32)))));
        return _sharedHash!.Value;
    }

    // Demo:Enabled config key wins when set (non-empty); else the
    // demo_enabled feature flag. True ONLY for an explicit "true" — any
    // other value (missing, empty, garbage) fails closed.
    public static bool DemoEnabled(IConfiguration cfg, Dictionary<string, string> flags)
    {
        var cfgVal = cfg["Demo:Enabled"];
        var val = !string.IsNullOrEmpty(cfgVal) ? cfgVal : flags.GetValueOrDefault("demo_enabled");
        return string.Equals(val, "true", StringComparison.OrdinalIgnoreCase);
    }

    // The single flag-parsing helper for this workstream (GuestLimits.Flag in
    // D6 just delegates to this).
    internal static int Flag(Dictionary<string, string> f, string k, int d) =>
        f.TryGetValue(k, out var r) && int.TryParse(r, out var v) && v >= 0 ? v : d;
}
