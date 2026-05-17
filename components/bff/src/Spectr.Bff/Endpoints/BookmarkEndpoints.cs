using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
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

        return app;
    }

    // GET /api/me/bookmarks — joined with the bookmarked analysis (for share
    // tokens) to surface a title/artist preview. Published tracks resolve to
    // a placeholder until the Discover slice lands.
    private static async Task<IResult> List(
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var bookmarks = await db.TrackBookmarks.AsNoTracking()
            .Where(b => b.UserId == userId)
            .OrderByDescending(b => b.CreatedAt)
            .ToListAsync(ct);

        var shareTokens = bookmarks
            .Where(b => b.TargetShareToken != null)
            .Select(b => b.TargetShareToken!)
            .ToHashSet();

        // Pull title via Analysis.SongName for any share-token targets. Owner
        // identity (artist) joins through Users.DisplayName / Handle.
        var titleMap = new Dictionary<string, (string? Title, string? Artist)>();
        if (shareTokens.Count > 0)
        {
            var rows = await (
                from a in db.Analyses.AsNoTracking()
                join u in db.Users.AsNoTracking() on a.UserId equals u.Id
                where a.ShareToken != null && shareTokens.Contains(a.ShareToken)
                select new
                {
                    a.ShareToken,
                    a.SongName,
                    Artist = u.DisplayName ?? u.Handle,
                }).ToListAsync(ct);
            foreach (var r in rows)
                titleMap[r.ShareToken!] = (r.SongName, r.Artist);
        }

        var dtos = bookmarks.Select(b =>
        {
            var hit = b.TargetShareToken != null
                && titleMap.TryGetValue(b.TargetShareToken, out var x)
                    ? x
                    : (Title: (string?)null, Artist: (string?)null);
            return new BookmarkDto(
                b.Id, b.TargetShareToken, b.TargetPublishedTrack,
                hit.Title, hit.Artist, b.CreatedAt);
        }).ToList();

        return Results.Ok(dtos);
    }

    private static async Task<IResult> Create(
        CreateBookmarkRequest body,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        // Exactly one target — enforced both by the DB CHECK constraint and
        // here so we can return a useful 400 instead of a constraint error.
        var hasToken = !string.IsNullOrWhiteSpace(body.TargetShareToken);
        var hasPub = body.TargetPublishedTrack is not null;
        if (hasToken == hasPub)
            return Results.BadRequest(new
            {
                error = "Provide exactly one of target_share_token or target_published_track.",
            });

        if (hasToken)
        {
            // Reject tokens that don't resolve to an analysis with sharing
            // currently enabled — prevents poisoning the feed with garbage IDs.
            var valid = await db.Analyses
                .AnyAsync(a => a.ShareToken == body.TargetShareToken, ct);
            if (!valid) return Results.NotFound(new { error = "Share token not found." });
        }

        // Dedupe: if the user already bookmarked the same target, return
        // the existing row instead of creating a duplicate.
        var existing = await db.TrackBookmarks
            .FirstOrDefaultAsync(b => b.UserId == userId
                && b.TargetShareToken == body.TargetShareToken
                && b.TargetPublishedTrack == body.TargetPublishedTrack, ct);
        if (existing is not null)
        {
            return Results.Ok(new BookmarkDto(
                existing.Id, existing.TargetShareToken, existing.TargetPublishedTrack,
                null, null, existing.CreatedAt));
        }

        var row = new TrackBookmark
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            TargetShareToken = body.TargetShareToken,
            TargetPublishedTrack = body.TargetPublishedTrack,
        };
        db.TrackBookmarks.Add(row);
        await db.SaveChangesAsync(ct);
        return Results.Created($"/api/me/bookmarks/{row.Id}",
            new BookmarkDto(row.Id, row.TargetShareToken, row.TargetPublishedTrack,
                null, null, row.CreatedAt));
    }

    private static async Task<IResult> Delete(
        Guid bookmarkId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var deleted = await db.TrackBookmarks
            .Where(b => b.Id == bookmarkId && b.UserId == userId)
            .ExecuteDeleteAsync(ct);
        return deleted > 0 ? Results.NoContent() : Results.NotFound();
    }
}
