using Microsoft.EntityFrameworkCore;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
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
        return app;
    }

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
            where v.Id == versionId
            select new { v.VersionNumber, SongName = s.Name }).FirstOrDefaultAsync(ct);
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
            acc.Gates));
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
