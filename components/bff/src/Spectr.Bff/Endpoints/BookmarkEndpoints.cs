using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Security.Claims;

namespace Spectr.Bff.Endpoints;

public static class BookmarkEndpoints
{
    public static IEndpointRouteBuilder MapBookmarkEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/me/bookmarks").WithTags("bookmarks").RequireAuthorization();
        g.MapGet("/", List);
        g.MapPost("/", Create);
        g.MapDelete("/{bookmarkId:guid}", Delete);

        // PRP-6 — owner-only aggregate signal for a version's bookmarks (D5.4).
        var vg = app.MapGroup("/versions/{versionId:guid}/bookmarks")
            .WithTags("bookmarks").RequireAuthorization();
        vg.MapGet("/signal", Signal);
        return app;
    }

    // GET /api/me/bookmarks — the caller's bookmarks (share-token, published, or
    // version targets). Anon rows never appear here (they have no user_id). Title
    // resolves from the analysis (share tokens) or the song (version targets).
    private static async Task<IResult> List(
        ClaimsPrincipal currentUser, AppDbContext db, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var bookmarks = await db.TrackBookmarks.AsNoTracking()
            .Where(b => b.UserId == userId)
            .OrderByDescending(b => b.CreatedAt)
            .ToListAsync(ct);

        var shareTokens = bookmarks
            .Where(b => b.TargetShareToken != null).Select(b => b.TargetShareToken!).ToHashSet();
        var versionIds = bookmarks
            .Where(b => b.TargetVersionId != null).Select(b => b.TargetVersionId!.Value).ToHashSet();

        var titleMap = new Dictionary<string, (string? Title, string? Artist)>();
        if (shareTokens.Count > 0)
        {
            var rows = await (
                from a in db.Analyses.AsNoTracking()
                join u in db.Users.AsNoTracking() on a.UserId equals u.Id
                where a.ShareToken != null && shareTokens.Contains(a.ShareToken)
                select new { a.ShareToken, a.SongName, Artist = u.DisplayName ?? u.Handle })
                .ToListAsync(ct);
            foreach (var r in rows) titleMap[r.ShareToken!] = (r.SongName, r.Artist);
        }

        var versionMap = new Dictionary<Guid, (string? Title, string? Artist)>();
        if (versionIds.Count > 0)
        {
            var rows = await (
                from v in db.SongVersions.AsNoTracking()
                join s in db.Songs.AsNoTracking() on v.SongId equals s.Id
                join u in db.Users.AsNoTracking() on s.UserId equals u.Id
                where versionIds.Contains(v.Id)
                select new { v.Id, s.Name, Artist = u.DisplayName ?? u.Handle })
                .ToListAsync(ct);
            foreach (var r in rows) versionMap[r.Id] = (r.Name, r.Artist);
        }

        var dtos = bookmarks.Select(b =>
        {
            var (title, artist) =
                b.TargetShareToken != null && titleMap.TryGetValue(b.TargetShareToken, out var x) ? x
                : b.TargetVersionId is Guid vid && versionMap.TryGetValue(vid, out var y) ? y
                : (Title: (string?)null, Artist: (string?)null);
            return new BookmarkDto(
                b.Id, b.TargetShareToken, b.TargetPublishedTrack, b.TargetVersionId,
                b.TimestampSeconds, b.Note, b.IdentityVisible, title, artist, b.CreatedAt);
        }).ToList();

        return Results.Ok(dtos);
    }

    private static async Task<IResult> Create(
        CreateBookmarkRequest body, ClaimsPrincipal currentUser, AppDbContext db,
        AccessService access, INotificationSink notif, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var hasToken = !string.IsNullOrWhiteSpace(body.TargetShareToken);
        var hasPub = body.TargetPublishedTrack is not null;
        var hasVersion = body.TargetVersionId is not null;
        if (hasToken ? (hasPub || hasVersion) : (hasPub == hasVersion))
            return Results.BadRequest(new
            {
                error = "Provide exactly one of target_share_token, target_published_track, target_version_id.",
            });

        if (hasToken && !await db.Analyses.AnyAsync(a => a.ShareToken == body.TargetShareToken, ct))
            return Results.NotFound(new { error = "Share token not found." });

        if (body.TargetVersionId is Guid versionId)
        {
            // Gate: canBookmark (canView + bookmarking_allowed) — PRP-2.
            var acc = await access.ResolveAsync(versionId, userId, viaValidToken: false, ct);
            if (!acc.Gates.CanBookmark)
                return ErrorEnvelope.Build(403, "bookmark_forbidden", "Bookmarking isn't allowed here.");
        }

        // Dedup: same user + same target (version dedup also keys on the moment).
        var existing = await db.TrackBookmarks.FirstOrDefaultAsync(b => b.UserId == userId
            && b.TargetShareToken == body.TargetShareToken
            && b.TargetPublishedTrack == body.TargetPublishedTrack
            && b.TargetVersionId == body.TargetVersionId
            && b.TimestampSeconds == body.T, ct);
        if (existing is not null)
        {
            // Allow toggling identity_visible on a repeat call (owner-signal opt-in/out).
            if (existing.TargetVersionId != null && existing.IdentityVisible != body.IdentityVisible)
            {
                existing.IdentityVisible = body.IdentityVisible;
                await db.SaveChangesAsync(ct);
            }
            return Results.Ok(ToDto(existing));
        }

        var row = new TrackBookmark
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            TargetShareToken = body.TargetShareToken,
            TargetPublishedTrack = body.TargetPublishedTrack,
            TargetVersionId = body.TargetVersionId,
            TimestampSeconds = body.T,
            Note = Trim(body.Note, 280),
            IdentityVisible = body.TargetVersionId != null && body.IdentityVisible,
        };
        db.TrackBookmarks.Add(row);
        await db.SaveChangesAsync(ct);

        // Story 11.6 (AC3): version bookmarks roll into the owner's daily digest
        // ("N people bookmarked X today"). Self-bookmarks don't notify.
        if (body.TargetVersionId is Guid bvid)
        {
            var ownerId = await (
                from v in db.SongVersions.AsNoTracking()
                join s in db.Songs.AsNoTracking() on v.SongId equals s.Id
                where v.Id == bvid
                select (Guid?)s.UserId).FirstOrDefaultAsync(ct);
            if (ownerId is Guid oid && oid != userId)
                await notif.NotifyDigestAsync(ActorRef.User(oid), "bookmark", bvid, ct);
        }
        return Results.Created($"/api/me/bookmarks/{row.Id}", ToDto(row));
    }

    private static async Task<IResult> Delete(
        Guid bookmarkId, ClaimsPrincipal currentUser, AppDbContext db, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var deleted = await db.TrackBookmarks
            .Where(b => b.Id == bookmarkId && b.UserId == userId)
            .ExecuteDeleteAsync(ct);
        return deleted > 0 ? Results.NoContent() : Results.NotFound();
    }

    // GET /api/versions/{id}/bookmarks/signal — owner-only (D5.4). Count includes
    // anon bookmarks anonymously; only identity_visible NAMED bookmarkers surface.
    private static async Task<IResult> Signal(
        Guid versionId, ClaimsPrincipal currentUser, AppDbContext db, AccessService access,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var acc = await access.ResolveAsync(versionId, userId, viaValidToken: false, ct);
        if (acc.Role != "owner")
            return ErrorEnvelope.Build(403, "not_owner", "Only the owner can see the bookmark signal.");

        var count = await db.TrackBookmarks.AsNoTracking()
            .CountAsync(b => b.TargetVersionId == versionId, ct);
        var identifiedIds = await db.TrackBookmarks.AsNoTracking()
            .Where(b => b.TargetVersionId == versionId && b.UserId != null && b.IdentityVisible)
            .Select(b => b.UserId!.Value).Distinct().ToListAsync(ct);

        var identified = new List<ActorRefDto>(identifiedIds.Count);
        foreach (var uid in identifiedIds)
            identified.Add(await ActorProjection.ToDtoAsync(ActorRef.User(uid), db, ct));

        return Results.Ok(new BookmarkSignalDto(count, identified));
    }

    private static BookmarkDto ToDto(TrackBookmark b) => new(
        b.Id, b.TargetShareToken, b.TargetPublishedTrack, b.TargetVersionId,
        b.TimestampSeconds, b.Note, b.IdentityVisible, null, null, b.CreatedAt);

    private static string? Trim(string? s, int cap)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        var t = s.Trim();
        return t.Length > cap ? t[..cap] : t;
    }
}
