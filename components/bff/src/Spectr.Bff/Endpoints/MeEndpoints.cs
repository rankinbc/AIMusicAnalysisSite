using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using System.Security.Claims;

namespace Spectr.Bff.Endpoints;

public static class MeEndpoints
{
    public static IEndpointRouteBuilder MapMeEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/me").WithTags("me").RequireAuthorization();

        g.MapGet("/profile", GetProfile);
        g.MapPatch("/profile", PatchProfile);
        g.MapGet("/stats", GetStats);
        g.MapGet("/activity", GetActivity);
        g.MapGet("/entitlements", GetEntitlements);
        g.MapGet("/honest-math", GetHonestMath);

        return app;
    }

    // GET /api/me/profile — full profile (superset of /auth/me)
    private static async Task<IResult> GetProfile(
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        // Story 2.1 review-fix P9 — include tier via LEFT JOIN against
        // subscriptions so /me/profile agrees with /auth/me on Pro state.
        var row = await (
            from x in db.Users.AsNoTracking()
            join s in db.Subscriptions.AsNoTracking()
                on x.Id equals s.UserId into joined
            from sub in joined.DefaultIfEmpty()
            where x.Id == userId
            select new
            {
                x.Id, x.Email, x.Handle, x.DisplayName, x.Bio,
                x.AvatarHue, x.BannerHue, x.Accent, x.PublicLink,
                x.NotifyAnalysisComplete,
                SubStatus = sub == null ? null : sub.Status,
            }
        ).FirstOrDefaultAsync(ct);
        if (row is null) return Results.Unauthorized();
        var tier = AuthEndpoints.ResolveTier(row.SubStatus);
        return Results.Ok(new MeProfileDto(
            row.Id, row.Email, row.Handle, row.DisplayName, row.Bio,
            row.AvatarHue, row.BannerHue, row.Accent, row.PublicLink, tier,
            row.NotifyAnalysisComplete));
    }

    // PATCH /api/me/profile — full profile patch (display_name+handle also
    // accepted on /auth/me; this endpoint additionally handles bio, hues,
    // accent, public_link).
    private static async Task<IResult> PatchProfile(
        PatchMeProfileRequest req,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null) return Results.Unauthorized();

        var errors = new Dictionary<string, string[]>();

        if (req.DisplayName is not null)
        {
            var t = req.DisplayName.Trim();
            if (t.Length == 0) errors["displayName"] = ["Display name cannot be empty."];
            else if (t.Length > 80) errors["displayName"] = ["Max 80 chars."];
            else user.DisplayName = t;
        }

        if (req.Handle is not null)
        {
            var normalized = NormalizeHandle(req.Handle);
            if (normalized.Length < 3 || normalized.Length > 32)
                errors["handle"] = ["3–32 chars of [a-z0-9_]."];
            else if (!string.Equals(normalized, user.Handle, StringComparison.OrdinalIgnoreCase))
            {
                var taken = await db.Users
                    .AnyAsync(u => u.Id != userId && u.Handle == normalized, ct);
                if (taken) errors["handle"] = ["Handle taken."];
                else user.Handle = normalized;
            }
        }

        if (req.Bio is not null)
        {
            var t = req.Bio.Trim();
            if (t.Length > 500) errors["bio"] = ["Max 500 chars."];
            else user.Bio = t.Length == 0 ? null : t;
        }

        if (req.AvatarHue is not null) user.AvatarHue = ClampHue(req.AvatarHue.Value);
        if (req.BannerHue is not null) user.BannerHue = ClampHue(req.BannerHue.Value);

        if (req.Accent is not null)
        {
            var t = req.Accent.Trim().ToLowerInvariant();
            if (t.Length > 16) errors["accent"] = ["Max 16 chars."];
            else user.Accent = t.Length == 0 ? null : t;
        }

        if (req.PublicLink is not null)
        {
            var t = req.PublicLink.Trim();
            if (t.Length > 200) errors["publicLink"] = ["Max 200 chars."];
            else user.PublicLink = t.Length == 0 ? null : t;
        }

        // Story 4.4 — completion-email opt-out toggle (null = unchanged).
        if (req.NotifyAnalysisComplete is { } notify)
            user.NotifyAnalysisComplete = notify;

        if (errors.Count > 0) return Results.ValidationProblem(errors);
        await db.SaveChangesAsync(ct);
        // Story 2.1 review-fix P9 — include tier in the PATCH response too.
        var tierAfter = AuthEndpoints.ResolveTier(
            await db.Subscriptions.AsNoTracking()
                .Where(s => s.UserId == userId)
                .Select(s => (string?)s.Status)
                .FirstOrDefaultAsync(ct));
        return Results.Ok(new MeProfileDto(
            user.Id, user.Email, user.Handle, user.DisplayName, user.Bio,
            user.AvatarHue, user.BannerHue, user.Accent, user.PublicLink, tierAfter,
            user.NotifyAnalysisComplete));
    }

    // GET /api/me/stats — top-of-profile summary numbers.
    private static async Task<IResult> GetStats(
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var monthAgo = DateTimeOffset.UtcNow.AddDays(-30);

        var songs = await db.Songs.CountAsync(s => s.UserId == userId && s.ArchivedAt == null, ct);
        var versions = await (
            from v in db.SongVersions
            join s in db.Songs on v.SongId equals s.Id
            where s.UserId == userId && s.ArchivedAt == null
            select v.Id).CountAsync(ct);
        var analyses = await db.Analyses.CountAsync(a => a.UserId == userId, ct);
        var thisMonth = await db.Analyses
            .CountAsync(a => a.UserId == userId && a.CreatedAt >= monthAgo, ct);
        // `plays` is a per-track concept not yet tracked anywhere; emit 0 until
        // we wire playback telemetry on the Listen page.
        return Results.Ok(new MeStatsDto(songs, versions, analyses, thisMonth, Plays: 0));
    }

    // GET /api/me/activity — last N events across songs/versions/analyses.
    private static async Task<IResult> GetActivity(
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        const int Limit = 40;

        var analyses = await db.Analyses.AsNoTracking()
            .Where(a => a.UserId == userId)
            .OrderByDescending(a => a.CreatedAt)
            .Take(Limit)
            .Select(a => new ActivityItemDto(
                "analysis",
                $"Analyzed {(a.SongName ?? "a track")}",
                a.CreatedAt,
                a.SongId,
                a.VersionId,
                a.JobId))
            .ToListAsync(ct);

        var songs = await db.Songs.AsNoTracking()
            .Where(s => s.UserId == userId)
            .OrderByDescending(s => s.CreatedAt)
            .Take(Limit)
            .Select(s => new ActivityItemDto(
                "song",
                $"Created song “{s.Name}”",
                s.CreatedAt,
                (Guid?)s.Id,
                null,
                null))
            .ToListAsync(ct);

        var versions = await (
            from v in db.SongVersions.AsNoTracking()
            join s in db.Songs.AsNoTracking() on v.SongId equals s.Id
            where s.UserId == userId
            orderby v.CreatedAt descending
            select new ActivityItemDto(
                "version",
                $"Uploaded v{v.VersionNumber} of “{s.Name}”",
                v.CreatedAt,
                (Guid?)v.SongId,
                (Guid?)v.Id,
                null))
            .Take(Limit)
            .ToListAsync(ct);

        var merged = analyses
            .Concat(songs)
            .Concat(versions)
            .OrderByDescending(x => x.OccurredAt)
            .Take(Limit)
            .ToList();

        return Results.Ok(merged);
    }

    // Mirror of HandleSeeder.Sanitize — kept local to avoid coupling profile
    // patches to that service. Same rules: lower-cased, `[a-z0-9_]` only,
    // collapsed underscores.
    private static string NormalizeHandle(string raw)
    {
        var s = raw.Trim().ToLowerInvariant();
        var buf = new System.Text.StringBuilder(s.Length);
        foreach (var ch in s)
        {
            if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '_')
                buf.Append(ch);
            else if (ch == ' ' || ch == '-' || ch == '.')
                buf.Append('_');
        }
        // collapse repeated underscores
        var collapsed = System.Text.RegularExpressions.Regex.Replace(buf.ToString(), "_+", "_");
        return collapsed.Trim('_');
    }

    // GET /api/me/entitlements — caller's current entitlement snapshot.
    // Story 2.4 / AR12. No entitlement check on results read paths (AR15).
    private static async Task<IResult> GetEntitlements(
        ClaimsPrincipal currentUser,
        EntitlementService ents,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        try
        {
            var dto = await ents.ForAsync(userId, ct);
            return Results.Ok(dto);
        }
        catch (Exception)
        {
            return ErrorEnvelope.Build(503, "entitlements_unavailable",
                "Entitlement service temporarily unavailable.");
        }
    }

    // GET /api/me/honest-math — 90-day credit spend vs Pro-equivalent.
    // Story 2.8 / FR32 / UX-DR32. Drives the dismissible HonestMathBanner.
    private static async Task<IResult> GetHonestMath(
        ClaimsPrincipal currentUser,
        HonestMathService honestMath,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        try
        {
            var dto = await honestMath.ForAsync(userId, ct);
            return Results.Ok(dto);
        }
        catch (Exception)
        {
            return ErrorEnvelope.Build(503, "honest_math_unavailable",
                "Usage comparison temporarily unavailable.");
        }
    }

    private static short ClampHue(short hue) =>
        (short)Math.Max(0, Math.Min(360, (int)hue));
}
