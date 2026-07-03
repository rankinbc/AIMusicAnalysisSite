using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Services;
using Spectr.Data;

namespace Spectr.Bff.Endpoints;

// Story 11.8 — the public profile read API. Unauthenticated + ip-rate-limited
// (AC5); only PUBLIC-visibility versions project (AC4 — unlisted/private never
// appear; the owner-safe subset is by construction: name/number/token only).
public static class ProfileEndpoints
{
    public static IEndpointRouteBuilder MapProfileEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/u").WithTags("profiles").AllowAnonymous();
        g.MapGet("/{handle}", GetPublicProfile);
        // Story 11.11 — handle prefix search for @mention autocomplete.
        g.MapGet("/", SearchHandles);
        return app;
    }

    public sealed record PublicVersionDto(
        string SongName, int VersionNumber, string ShareToken, DateTimeOffset? SharedAt);

    public sealed record PublicProfileDto(
        string Handle,
        string? DisplayName,
        string? Bio,
        string? PublicLink,
        int? AvatarHue,
        int? BannerHue,
        string? Accent,
        IReadOnlyList<PublicVersionDto> PublicVersions);

    private static async Task<IResult> GetPublicProfile(
        string handle,
        HttpContext http,
        AppDbContext db,
        IRateLimiter limiter,
        CancellationToken ct)
    {
        // Anonymous read — the ip arm is the only meaningful ceiling.
        var ip = http.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var rl = await limiter.CheckAsync($"ip:{ip}", ip, "public_profile",
            limit: 60, TimeSpan.FromMinutes(1), ct);
        if (!rl.Allowed)
            return ErrorEnvelope.Build(429, "rate_limited", "Too many requests — slow down.");

        // citext handle ⇒ case-insensitive match server-side.
        var user = await db.Users.AsNoTracking()
            .Where(u => u.Handle == handle && u.IsActive)
            .Select(u => new { u.Id, u.Handle, u.DisplayName, u.Bio, u.PublicLink, u.AvatarHue, u.BannerHue, u.Accent })
            .FirstOrDefaultAsync(ct);
        if (user is null || user.Handle is null) return Results.NotFound();

        // AC4: PUBLIC visibility only — unlisted and private never surface.
        var versions = await (
            from ss in db.ShareSettings.AsNoTracking()
            join v in db.SongVersions.AsNoTracking() on ss.SongVersionId equals v.Id
            join s in db.Songs.AsNoTracking() on v.SongId equals s.Id
            where s.UserId == user.Id && ss.Visibility == "public" && ss.ShareToken != null
            orderby ss.EnabledAt descending
            select new PublicVersionDto(s.Name, v.VersionNumber, ss.ShareToken!, ss.EnabledAt)
        ).Take(50).ToListAsync(ct);

        return Results.Ok(new PublicProfileDto(
            user.Handle, user.DisplayName, user.Bio, user.PublicLink,
            user.AvatarHue, user.BannerHue, user.Accent, versions));
    }

    public sealed record HandleSearchItemDto(string Handle, string? DisplayName, int? AvatarHue);
    public sealed record HandleSearchDto(IReadOnlyList<HandleSearchItemDto> Items);

    // Story 11.11 — GET /api/u/?q=<prefix>. Suggests handles the MentionParser
    // will subsequently match (same charset), so we validate q against the
    // mention token grammar instead of erroring on junk. Anonymous (the anon
    // composer on /v/{token} can mention too) + ip-rate-limited. Filters
    // IsActive per the /u/{handle} + follow convention — suggesting a user
    // whose profile 404s is a trap (MentionParser itself deliberately doesn't
    // filter IsActive; that asymmetry is fine: parsing is lenient, suggesting
    // is curated).
    private static async Task<IResult> SearchHandles(
        string? q,
        HttpContext http,
        AppDbContext db,
        IRateLimiter limiter,
        CancellationToken ct)
    {
        var ip = http.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var rl = await limiter.CheckAsync($"ip:{ip}", ip, "handle_search",
            limit: 60, TimeSpan.FromMinutes(1), ct);
        if (!rl.Allowed)
            return ErrorEnvelope.Build(429, "rate_limited", "Too many requests — slow down.");

        var query = (q ?? "").Trim();
        // Mention token grammar (MentionParser): 1-30 of [A-Za-z0-9._-],
        // starting alphanumeric. Anything else can't be a mention — empty list.
        if (query.Length is 0 or > 30
            || !char.IsAsciiLetterOrDigit(query[0])
            || !query.All(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '_' or '-'))
        {
            return Results.Ok(new HandleSearchDto([]));
        }

        // The grammar above excludes %/_-wildcard abuse except '_', which is a
        // legal handle char — escape it so it matches literally under ILike.
        var pattern = query.Replace("_", "\\_") + "%";

        var items = await db.Users.AsNoTracking()
            .Where(u => u.Handle != null && u.IsActive
                && EF.Functions.ILike(u.Handle, pattern, "\\"))
            .OrderBy(u => u.Handle)
            .Take(8)
            .Select(u => new HandleSearchItemDto(u.Handle!, u.DisplayName, u.AvatarHue))
            .ToListAsync(ct);

        return Results.Ok(new HandleSearchDto(items));
    }
}
