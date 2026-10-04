using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Spectr.Bff.DTOs;
using Spectr.Data;
using Spectr.Data.Entities;

namespace Spectr.Bff.Services;

// F1 (analytics + attribution) — persists a visitor's FIRST-TOUCH source on
// the users row so revenue can be grouped by channel in SQL (runbook:
// "Acquisition by source").
//
// The client sends what it captured at boot (frontend lib/attribution.ts);
// NOTHING here trusts it. Source/medium/campaign are slugged to [a-z0-9_-]
// (≤64) — `?ref=` is free text and may be an email address — and the referrer
// is reduced to a bare host (a full URL can carry search terms or tokens).
// First touch wins: a field is only ever written when it is still null.
public static partial class SignupAttributionWriter
{
    private const int SlugMax = 64;
    private const int HostMax = 128;
    private const int BodyMaxBytes = 2048;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [GeneratedRegex("^[a-z0-9.-]+$")]
    private static partial Regex HostPattern();

    public static string? Slug(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        Span<char> buf = stackalloc char[SlugMax];
        var n = 0;
        foreach (var ch in raw)
        {
            var c = char.ToLowerInvariant(ch);
            if (c is (>= 'a' and <= 'z') or (>= '0' and <= '9') or '_' or '-')
            {
                buf[n++] = c;
                if (n == SlugMax) break;
            }
        }
        return n == 0 ? null : new string(buf[..n]);
    }

    /// <summary>Accepts a bare host or a full URL; returns the lower-case host
    /// only, or null when it is malformed, too long, or the site's own host.</summary>
    public static string? Host(string? raw, string? ownHost)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var value = raw.Trim();
        if (value.Contains("://", StringComparison.Ordinal))
        {
            if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)) return null;
            value = uri.Host;
        }
        value = value.ToLowerInvariant();
        if (value.Length > HostMax || !HostPattern().IsMatch(value)) return null;
        if (ownHost is not null && string.Equals(value, ownHost, StringComparison.OrdinalIgnoreCase))
            return null;
        return value;
    }

    /// <summary>The sanitized attribution, or null when nothing usable remains.</summary>
    public static SignupAttribution? Clean(SignupAttribution? a, string? ownHost)
    {
        if (a is null) return null;
        var clean = new SignupAttribution(
            Slug(a.Source), Slug(a.Medium), Slug(a.Campaign), Host(a.Referrer, ownHost));
        return clean is { Source: null, Medium: null, Campaign: null, Referrer: null } ? null : clean;
    }

    /// <summary>Tracked-entity path (new users, the pending re-register row).</summary>
    public static void Apply(User user, SignupAttribution? a, string? ownHost)
    {
        if (Clean(a, ownHost) is not { } c) return;
        user.SignupSource ??= c.Source;
        user.SignupMedium ??= c.Medium;
        user.SignupCampaign ??= c.Campaign;
        user.SignupReferrer ??= c.Referrer;
    }

    /// <summary>Set-based path for flows that never load the row (guest
    /// convert). COALESCE keeps whatever the guest mint already recorded.</summary>
    public static async Task FillMissingAsync(
        AppDbContext db, Guid userId, SignupAttribution? a, string? ownHost, CancellationToken ct)
    {
        if (Clean(a, ownHost) is not { } c) return;
        await db.Users.Where(u => u.Id == userId).ExecuteUpdateAsync(s => s
            .SetProperty(u => u.SignupSource, u => u.SignupSource ?? c.Source)
            .SetProperty(u => u.SignupMedium, u => u.SignupMedium ?? c.Medium)
            .SetProperty(u => u.SignupCampaign, u => u.SignupCampaign ?? c.Campaign)
            .SetProperty(u => u.SignupReferrer, u => u.SignupReferrer ?? c.Referrer), ct);
    }

    /// <summary>Tolerant body read for POST /auth/demo, which is normally
    /// body-less: an absent, oversized, non-JSON or malformed body is simply
    /// "no attribution" — it must never fail the guest mint.</summary>
    public static async Task<SignupAttribution?> TryReadBodyAsync(HttpRequest req, CancellationToken ct)
    {
        try
        {
            if (!req.HasJsonContentType() || req.ContentLength > BodyMaxBytes) return null;
            // Bounded read — Content-Length may be absent (chunked), so the
            // cap is enforced on the bytes actually read.
            var buf = new byte[BodyMaxBytes + 1];
            var read = 0;
            while (read < buf.Length)
            {
                var n = await req.Body.ReadAsync(buf.AsMemory(read), ct);
                if (n == 0) break;
                read += n;
            }
            if (read == 0 || read > BodyMaxBytes) return null;
            return JsonSerializer.Deserialize<DemoStartRequest>(buf.AsSpan(0, read), Json)?.Attribution;
        }
        catch (Exception ex) when (ex is JsonException or IOException or BadHttpRequestException)
        {
            return null;
        }
    }
}
