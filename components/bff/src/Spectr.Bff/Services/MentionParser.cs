using Microsoft.EntityFrameworkCore;
using Spectr.Data;
using System.Text.RegularExpressions;

namespace Spectr.Bff.Services;

/// <summary>
/// Story 11.6 — extracts @handle mentions from comment bodies and resolves
/// them to user ids. Handles are citext in the DB, so resolution is
/// case-insensitive for free; the regex mirrors the handle charset
/// (word chars, dot, dash), 1..30 chars, and requires a non-word (or
/// start-of-string) boundary before the @ so emails don't match.
/// </summary>
public static partial class MentionParser
{
    [GeneratedRegex(@"(?<![\w@])@([A-Za-z0-9][\w.\-]{0,29})", RegexOptions.CultureInvariant)]
    private static partial Regex MentionRegex();

    /// <summary>Distinct raw handles mentioned in the body (as typed, sans @).</summary>
    public static IReadOnlyList<string> ExtractHandles(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return [];
        return MentionRegex().Matches(body)
            .Select(m => m.Groups[1].Value)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>Resolves mentioned handles to user ids (unknown handles drop silently).</summary>
    public static async Task<IReadOnlyList<Guid>> ResolveMentionedUserIdsAsync(
        AppDbContext db, string body, CancellationToken ct = default)
    {
        var handles = ExtractHandles(body);
        if (handles.Count == 0) return [];
        // citext column ⇒ case-insensitive equality server-side.
        return await db.Users.AsNoTracking()
            .Where(u => u.Handle != null && handles.Contains(u.Handle))
            .Select(u => u.Id)
            .ToListAsync(ct);
    }
}
