using Microsoft.EntityFrameworkCore;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Security.Claims;

namespace Spectr.Bff.Endpoints;

// Listen V3 (PRP-2) — anonymous View entry via an opaque version share token.
// AllowAnonymous: the token IS the grant (no JWT). Token resolves through
// ResourceTokenAuth (Kind="share") — explicitly NOT the JwtBearer ?t= path (G1).
// The durable anon identity (spectr_anon cookie) is the actor when unauthenticated.
public static class VersionViewEndpoints
{
    public static IEndpointRouteBuilder MapVersionViewEndpoints(this IEndpointRouteBuilder app)
    {
        var pub = app.MapGroup("/v/{token}").WithTags("version-view").AllowAnonymous();
        pub.MapGet("/", GetVersionView);
        pub.MapGet("/audio", StreamVersionAudio);
        pub.MapPost("/bookmark", CreateAnonBookmark);   // PRP-6 — anon/named bookmark via the share link
        return app;
    }

    // POST /api/v/{token}/bookmark — a viewer (anon via signed cookie, or authed)
    // bookmarks the shared version, optionally at a moment + with a note. Gated on
    // canBookmark (PRP-2). Anon is NEVER identity-visible (D5.4); the server row
    // exists so the bookmark counts toward the author signal (the anon's personal
    // "my bookmarks" is browser-local — no durable anon library). Anon attribution
    // keys on the durable signed anonId (not ip_hash), so dedup + count are stable.
    private static async Task<IResult> CreateAnonBookmark(
        string token, AnonBookmarkRequest body, ClaimsPrincipal user,
        ResourceTokenAuth tokenAuth, AccessService access, AppDbContext db, CancellationToken ct)
    {
        var resolved = await tokenAuth.ResolveAsync("share", token, user, ct);
        if (resolved is null) return Results.NotFound();
        var versionId = resolved.Resource.ResourceId;
        var userId = resolved.Actor.Type == ActorType.User ? resolved.Actor.UserId : null;
        var anonId = resolved.Actor.Type == ActorType.Anon ? resolved.Actor.AnonId : null;

        var acc = await access.ResolveAsync(versionId, userId, viaValidToken: true, ct);
        if (!acc.CanView) return Results.NotFound();
        if (!acc.Gates.CanBookmark)
            return ErrorEnvelope.Build(403, "bookmark_forbidden", "Bookmarking isn't allowed here.");

        var t = body?.T;
        // Dedup: authed by (user, version, t); anon by (anon_id, version, t).
        var existing = await db.TrackBookmarks.FirstOrDefaultAsync(b =>
            b.TargetVersionId == versionId && b.TimestampSeconds == t
            && ((userId != null && b.UserId == userId)
                || (anonId != null && b.BookmarkerAnonId == anonId)), ct);
        if (existing is not null) return Results.Ok(BookmarkOf(existing));

        var note = string.IsNullOrWhiteSpace(body?.Note) ? null
            : (body!.Note!.Trim().Length > 280 ? body.Note.Trim()[..280] : body.Note.Trim());
        var row = new TrackBookmark
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            TargetVersionId = versionId,
            BookmarkerAnonId = userId is null ? anonId : null,
            TimestampSeconds = t,
            Note = note,
            IdentityVisible = false,   // anon never identified (D5.4)
        };
        db.TrackBookmarks.Add(row);
        await db.SaveChangesAsync(ct);
        return Results.Created($"/api/v/{token}/bookmark/{row.Id}", BookmarkOf(row));
    }

    private static BookmarkDto BookmarkOf(TrackBookmark b) => new(
        b.Id, b.TargetShareToken, b.TargetPublishedTrack, b.TargetVersionId,
        b.TimestampSeconds, b.Note, b.IdentityVisible, null, null, b.CreatedAt);

    // Resolve token → versionId, attach actor, and gate on CanView. Returns
    // (versionId, userId) or null when the token doesn't resolve / no view access.
    private static async Task<(Guid VersionId, Guid? UserId)?> ResolveViewableAsync(
        string token, ClaimsPrincipal user, ResourceTokenAuth tokenAuth, AccessService access,
        CancellationToken ct)
    {
        var resolved = await tokenAuth.ResolveAsync("share", token, user, ct);
        if (resolved is null) return null;
        var versionId = resolved.Resource.ResourceId;
        var userId = resolved.Actor.Type == ActorType.User ? resolved.Actor.UserId : null;
        var acc = await access.ResolveAsync(versionId, userId, viaValidToken: true, ct);
        if (!acc.CanView) return null;
        return (versionId, userId);
    }

    private static async Task<IResult> GetVersionView(
        string token, ClaimsPrincipal user, ResourceTokenAuth tokenAuth, AccessService access,
        AppDbContext db, CancellationToken ct)
    {
        var hit = await ResolveViewableAsync(token, user, tokenAuth, access, ct);
        if (hit is null) return Results.NotFound();
        var (versionId, userId) = hit.Value;

        var info = await (
            from v in db.SongVersions.AsNoTracking()
            join s in db.Songs.AsNoTracking() on v.SongId equals s.Id
            join u in db.Users.AsNoTracking() on s.UserId equals u.Id
            where v.Id == versionId
            select new
            {
                v.VersionNumber,
                SongName = s.Name,
                // Story 11.11 — owner public identity for the follow CTA.
                // Only when the owner is followable (/u/{handle} convention).
                OwnerHandle = u.IsActive ? u.Handle : null,
                OwnerDisplayName = u.IsActive ? u.DisplayName : null,
            }).FirstOrDefaultAsync(ct);
        if (info is null) return Results.NotFound();

        var settings = await db.ShareSettings.AsNoTracking()
            .FirstOrDefaultAsync(x => x.SongVersionId == versionId, ct);
        var acc = await access.ResolveAsync(versionId, userId, viaValidToken: true, ct);

        // Grade/Score live in analyses.final_json; the View page fetches the full
        // analysis on demand (gated by ShowVerdicts). Left null here to avoid a
        // brittle final_json reach into this entry payload.
        return Results.Ok(new VersionViewDto(
            versionId, info.SongName, info.VersionNumber,
            settings?.Visibility ?? "private",
            settings?.ShowVerdicts ?? false,
            Grade: null, Score: null,
            acc.Gates,
            info.OwnerHandle, info.OwnerDisplayName));
    }

    private static async Task<IResult> StreamVersionAudio(
        string token, ClaimsPrincipal user, ResourceTokenAuth tokenAuth, AccessService access,
        AppDbContext db, IFileStorage storage, CancellationToken ct)
    {
        var hit = await ResolveViewableAsync(token, user, tokenAuth, access, ct);
        if (hit is null) return Results.NotFound();
        var (versionId, _) = hit.Value;

        var filePath = await db.SongVersions.AsNoTracking()
            .Where(v => v.Id == versionId)
            .Select(v => v.FilePath)
            .FirstOrDefaultAsync(ct);
        if (filePath is null || !await storage.ExistsAsync(filePath, ct)) return Results.NotFound();

        var stream = await storage.OpenReadAsync(filePath, ct);
        var ext = Path.GetExtension(filePath).ToLowerInvariant();
        var contentType = ext switch
        {
            ".wav" => "audio/wav",
            ".flac" => "audio/flac",
            ".mp3" => "audio/mpeg",
            ".aif" or ".aiff" => "audio/aiff",
            ".ogg" or ".oga" => "audio/ogg",
            ".m4a" => "audio/mp4",
            _ => "application/octet-stream",
        };
        return Results.File(stream, contentType, enableRangeProcessing: true);
    }
}
