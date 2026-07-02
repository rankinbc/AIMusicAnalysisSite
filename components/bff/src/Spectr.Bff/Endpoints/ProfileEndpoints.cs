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
        app.MapGroup("/u").WithTags("profiles").AllowAnonymous()
            .MapGet("/{handle}", GetPublicProfile);
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
}
