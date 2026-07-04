using Microsoft.Extensions.Caching.Memory;
using Microsoft.EntityFrameworkCore;
using Spectr.Data;

namespace Spectr.Bff.Services;

// Story 10.6 (FR47) — disposable-email detection for THROTTLING, never hard
// blocking (false positives + an unwinnable arms race). The embedded list
// covers the common providers; `disposable_extra_domains` (feature flag,
// comma-separated) extends it live via the 10.5 admin surface — an abuser's
// fresh domain is one flag write away from contained, no deploy.
public sealed class DisposableEmailService(IServiceScopeFactory scopes, IMemoryCache cache)
{
    // Curated common disposable providers (lowercase). Deliberately the
    // well-known families, not an exhaustive mirror of the internet — the
    // flag extension is the living half.
    private static readonly HashSet<string> Builtin = new(StringComparer.OrdinalIgnoreCase)
    {
        "mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org",
        "guerrillamailblock.com", "sharklasers.com", "grr.la", "pokemail.net", "spam4.me",
        "yopmail.com", "yopmail.fr", "yopmail.net", "cool.fr.nf", "jetable.fr.nf",
        "10minutemail.com", "10minutemail.net", "10minemail.com", "20minutemail.com",
        "temp-mail.org", "temp-mail.io", "tempmail.dev", "tempmailo.com", "tempail.com",
        "tempr.email", "discard.email", "discardmail.com", "spambog.com", "spambog.de",
        "trashmail.com", "trashmail.de", "trashmail.me", "kurzepost.de", "wegwerfmail.de",
        "wegwerfmail.net", "mytrashmail.com", "mt2015.com", "mailnesia.com", "mailcatch.com",
        "dispostable.com", "fakeinbox.com", "spamgourmet.com", "mintemail.com", "mohmal.com",
        "getnada.com", "nada.email", "inboxkitten.com", "maildrop.cc", "harakirimail.com",
        "33mail.com", "spamex.com", "mailexpire.com", "tempinbox.com", "throwawaymail.com",
        "emailondeck.com", "mailsac.com", "burnermail.io", "mail-temp.com", "moakt.com",
        "tmpmail.org", "tmpmail.net", "tmails.net", "disposablemail.com", "crazymailing.com",
        "1secmail.com", "1secmail.org", "1secmail.net", "eztempmail.com", "mailpoof.com",
    };

    /// <summary>Exact-domain match against the builtin list + the
    /// `disposable_extra_domains` flag (60 s cached like every flag read).</summary>
    public async Task<bool> IsDisposableAsync(string email, CancellationToken ct = default)
    {
        var at = email.LastIndexOf('@');
        if (at < 0 || at == email.Length - 1) return false;
        var domain = email[(at + 1)..].Trim().ToLowerInvariant();
        if (Builtin.Contains(domain)) return true;

        var extra = await cache.GetOrCreateAsync("disposable_extra_domains", async e =>
        {
            e.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(60);
            try
            {
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var raw = await db.FeatureFlags.AsNoTracking()
                    .Where(f => f.Name == "disposable_extra_domains")
                    .Select(f => f.Value)
                    .FirstOrDefaultAsync(ct);
                return new HashSet<string>(
                    (raw ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries),
                    StringComparer.OrdinalIgnoreCase);
            }
            catch
            {
                return new HashSet<string>(); // fail-open — throttling layer only
            }
        });
        return extra is not null && extra.Contains(domain);
    }
}
