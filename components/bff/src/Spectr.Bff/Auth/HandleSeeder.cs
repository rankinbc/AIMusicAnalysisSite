using Microsoft.EntityFrameworkCore;
using Spectr.Data;
using System.Text;

namespace Spectr.Bff.Auth;

// Derives a handle from an email prefix, sanitizes to [a-z0-9_],
// pads to 3 chars, truncates to 32, and appends a numeric suffix
// on collision until unique.
public sealed class HandleSeeder(AppDbContext db)
{
    public async Task<string> SeedAsync(string email, CancellationToken ct = default)
    {
        var at = email.IndexOf('@');
        var prefix = at > 0 ? email[..at] : email;
        var sanitized = Sanitize(prefix);
        if (sanitized.Length < 3) sanitized = sanitized.PadRight(3, 'x');
        if (sanitized.Length > 28) sanitized = sanitized[..28]; // leave room for suffix

        var candidate = sanitized;
        var suffix = 0;
        while (await db.Users.AnyAsync(u => u.Handle == candidate, ct))
        {
            suffix++;
            candidate = $"{sanitized}{suffix}";
            if (suffix > 9_999) throw new InvalidOperationException("Handle namespace exhausted.");
        }
        return candidate;
    }

    private static string Sanitize(string raw)
    {
        var sb = new StringBuilder(raw.Length);
        foreach (var c in raw.ToLowerInvariant())
        {
            if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_')
                sb.Append(c);
            else if (c == '.' || c == '-' || c == '+')
                sb.Append('_');
        }
        return sb.ToString();
    }
}
