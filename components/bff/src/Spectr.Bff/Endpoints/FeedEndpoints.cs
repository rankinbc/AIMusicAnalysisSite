using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Data;
using System.Security.Claims;

namespace Spectr.Bff.Endpoints;

// Story 11.10 — the followed-users activity feed. Recipient-scoped through the
// JWT user id (every query is keyed off MY followees); visibility gating reuses
// the public-share clause from ProfileEndpoints (share_settings.visibility =
// 'public' AND share_token IS NOT NULL) so private/unlisted content never
// surfaces — including recaps published on non-public versions.
public static class FeedEndpoints
{
    private const int DefaultLimit = 30;
    private const int MaxLimit = 50;
    private const int SuggestionLimit = 5;

    public static IEndpointRouteBuilder MapFeedEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGroup("/me/feed").WithTags("feed").RequireAuthorization()
            .MapGet("/", GetFeed);
        return app;
    }

    public sealed record FeedItemDto(
        string Kind, // "share" | "recap"
        string Handle,
        string? DisplayName,
        string SongName,
        int VersionNumber,
        string ShareToken,
        DateTimeOffset OccurredAt);

    public sealed record FeedSuggestionDto(string Handle, string? DisplayName);

    public sealed record FeedPageDto(
        IReadOnlyList<FeedItemDto> Items,
        int Page,
        int Limit,
        bool HasMore,
        IReadOnlyList<FeedSuggestionDto>? Suggestions);

    // GET /api/me/feed?page=0&limit=30 — reverse-chron union of followees'
    // public version-shares (enabled_at) and published room recaps
    // (recap_published_at). Two small ordered pulls + in-memory merge.
    private static async Task<IResult> GetFeed(
        ClaimsPrincipal currentUser, AppDbContext db,
        int? page, int? limit, CancellationToken ct)
    {
        var me = currentUser.UserId();
        var take = Math.Clamp(limit ?? DefaultLimit, 1, MaxLimit);
        var pageN = Math.Max(0, page ?? 0);
        var skip = pageN * take;
        var pull = skip + take + 1; // enough rows per source to page + HasMore probe

        var followees = db.FollowRelations.AsNoTracking()
            .Where(f => f.FollowerId == me)
            .Select(f => f.FolloweeId);

        // Source A — public version-shares (the ProfileEndpoints gate, AC4).
        var shares = await (
            from ss in db.ShareSettings.AsNoTracking()
            join v in db.SongVersions.AsNoTracking() on ss.SongVersionId equals v.Id
            join s in db.Songs.AsNoTracking() on v.SongId equals s.Id
            join u in db.Users.AsNoTracking() on s.UserId equals u.Id
            where followees.Contains(s.UserId)
                && ss.Visibility == "public" && ss.ShareToken != null
                && ss.EnabledAt != null && u.Handle != null
            orderby ss.EnabledAt descending
            select new FeedItemDto(
                "share", u.Handle!, u.DisplayName, s.Name, v.VersionNumber,
                ss.ShareToken!, ss.EnabledAt!.Value)
        ).Take(pull).ToListAsync(ct);

        // Source B — published recaps, still gated on the version being public:
        // a recap on a private/unlisted version never surfaces.
        var recaps = await (
            from ls in db.ListeningSessions.AsNoTracking()
            join ss in db.ShareSettings.AsNoTracking() on ls.SongVersionId equals ss.SongVersionId
            join v in db.SongVersions.AsNoTracking() on ls.SongVersionId equals v.Id
            join s in db.Songs.AsNoTracking() on v.SongId equals s.Id
            join u in db.Users.AsNoTracking() on ls.HostId equals u.Id
            where followees.Contains(ls.HostId)
                && ls.RecapPublishedAt != null
                && ss.Visibility == "public" && ss.ShareToken != null
                && u.Handle != null
            orderby ls.RecapPublishedAt descending
            select new FeedItemDto(
                "recap", u.Handle!, u.DisplayName, s.Name, v.VersionNumber,
                ss.ShareToken!, ls.RecapPublishedAt!.Value)
        ).Take(pull).ToListAsync(ct);

        var merged = shares.Concat(recaps)
            .OrderByDescending(i => i.OccurredAt)
            .Skip(skip)
            .Take(take + 1)
            .ToList();

        var hasMore = merged.Count > take;
        var items = merged.Take(take).ToList();

        // AC2 — first page of an empty feed carries discovery suggestions:
        // recent public sharers (excluding me + already-followed). Public data only.
        IReadOnlyList<FeedSuggestionDto>? suggestions = null;
        if (pageN == 0 && items.Count == 0)
        {
            var sharers = await (
                from ss in db.ShareSettings.AsNoTracking()
                join v in db.SongVersions.AsNoTracking() on ss.SongVersionId equals v.Id
                join s in db.Songs.AsNoTracking() on v.SongId equals s.Id
                join u in db.Users.AsNoTracking() on s.UserId equals u.Id
                where ss.Visibility == "public" && ss.ShareToken != null
                    && ss.EnabledAt != null && u.Handle != null && u.IsActive
                    && s.UserId != me && !followees.Contains(s.UserId)
                orderby ss.EnabledAt descending
                select new { u.Handle, u.DisplayName }
            ).Take(SuggestionLimit * 10).ToListAsync(ct); // pre-distinct window

            suggestions = sharers
                .DistinctBy(x => x.Handle)
                .Take(SuggestionLimit)
                .Select(x => new FeedSuggestionDto(x.Handle!, x.DisplayName))
                .ToList();
        }

        return Results.Ok(new FeedPageDto(items, pageN, take, hasMore, suggestions));
    }
}
