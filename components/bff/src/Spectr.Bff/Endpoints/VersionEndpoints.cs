using Spectr.Bff.Infrastructure;

using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Security.Claims;

namespace Spectr.Bff.Endpoints;

public static class VersionEndpoints
{
    private const long MaxUploadBytes = 250L * 1024 * 1024;

    public static IEndpointRouteBuilder MapVersionEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/versions").WithTags("versions").RequireAuthorization();

        g.MapPost("/", UploadVersion)
            .DisableAntiforgery()
            .WithMetadata(new RequestSizeLimitAttribute(MaxUploadBytes));

        g.MapGet("/{versionId:guid}", GetById);
        g.MapDelete("/{versionId:guid}", Delete);

        // Slice 1: not shipped. Patching, set-current, notes, audio streaming, re-analyze
        // are deferred until later slices (Listen, Notes). Stubs bind their path params
        // so OpenAPI describes them and orval codegen succeeds.
        g.MapPatch("/{versionId:guid}", (Guid versionId) => NotImplementedResult.Stub());
        g.MapPost("/{versionId:guid}/analyze", (Guid versionId) => NotImplementedResult.Stub());
        g.MapPost("/{versionId:guid}/set-current", (Guid versionId) => NotImplementedResult.Stub());
        g.MapGet("/{versionId:guid}/notes", (Guid versionId) => NotImplementedResult.Stub());
        g.MapPost("/{versionId:guid}/notes", (Guid versionId) => NotImplementedResult.Stub());
        g.MapPatch("/{versionId:guid}/notes/{noteId:guid}", (Guid versionId, Guid noteId) => NotImplementedResult.Stub());
        g.MapDelete("/{versionId:guid}/notes/{noteId:guid}", (Guid versionId, Guid noteId) => NotImplementedResult.Stub());
        g.MapGet("/{versionId:guid}/audio", StreamAudio);

        return app;
    }

    // GET /api/versions/{id}/audio
    // Streams the original uploaded audio. Accepts auth via Authorization header
    // OR ?t=<jwt> query param (HTMLMediaElement / <audio> cannot set headers).
    // Range requests are supported so the browser can seek without re-downloading.
    private static async Task<IResult> StreamAudio(
        Guid versionId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IFileStorage storage,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var row = await (
            from v in db.SongVersions.AsNoTracking()
            join s in db.Songs.AsNoTracking() on v.SongId equals s.Id
            where v.Id == versionId && s.UserId == userId
            select v
        ).FirstOrDefaultAsync(ct);
        if (row is null) return Results.NotFound();

        var key = row.FilePath;
        if (!await storage.ExistsAsync(key, ct)) return Results.NotFound();

        var stream = await storage.OpenReadAsync(key, ct);
        var ext = Path.GetExtension(key).ToLowerInvariant();
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

    // POST /api/versions  (multipart/form-data: file [required], song_id?, genre_hint?)
    private static async Task<IResult> UploadVersion(
        [FromForm] IFormFile file,
        [FromForm(Name = "song_id")] string? songId,
        [FromForm(Name = "genre_hint")] string? genreHint,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IFileStorage storage,
        IJobQueue queue,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        if (file is null || file.Length == 0)
            return Results.BadRequest(new { error = "Empty file." });
        if (file.Length > MaxUploadBytes)
            return Results.BadRequest(new { error = "File exceeds 250 MB limit." });

        Guid songGuid;
        if (!string.IsNullOrEmpty(songId))
        {
            if (!Guid.TryParse(songId, out songGuid))
                return Results.BadRequest(new { error = "Invalid song_id." });
            var owned = await db.Songs.AnyAsync(s => s.Id == songGuid && s.UserId == userId, ct);
            if (!owned) return Results.NotFound();
        }
        else
        {
            songGuid = Guid.NewGuid();
            var stem = Path.GetFileNameWithoutExtension(file.FileName);
            if (string.IsNullOrWhiteSpace(stem)) stem = "Untitled";
            db.Songs.Add(new Song
            {
                Id = songGuid,
                UserId = userId,
                Name = stem.Length > 200 ? stem[..200] : stem,
                GenreHint = string.IsNullOrWhiteSpace(genreHint) ? null : genreHint!.Trim(),
            });
        }

        var jobId = Guid.NewGuid();
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (string.IsNullOrEmpty(ext)) ext = ".bin";
        var key = $"audio/upload/{jobId}/source{ext}";

        // Stream to disk — do NOT buffer the whole file in memory.
        await using (var src = file.OpenReadStream())
        {
            await storage.WriteAsync(
                key,
                src,
                file.ContentType ?? "application/octet-stream",
                ct);
        }

        var nextVersionNumber = await db.SongVersions
            .Where(v => v.SongId == songGuid)
            .Select(v => (int?)v.VersionNumber)
            .MaxAsync(ct) ?? 0;
        nextVersionNumber++;

        // Demote any existing current version before inserting the new one.
        await db.SongVersions
            .Where(v => v.SongId == songGuid && v.IsCurrent)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.IsCurrent, false), ct);

        var versionId = Guid.NewGuid();
        db.SongVersions.Add(new SongVersion
        {
            Id = versionId,
            SongId = songGuid,
            VersionNumber = nextVersionNumber,
            FilePath = key,
            IsCurrent = true,
        });

        db.AnalysisJobs.Add(new AnalysisJob
        {
            Id = jobId,
            UserId = userId,
            VersionId = versionId,
            Status = "pending",
        });

        await db.SaveChangesAsync(ct);

        await queue.EnqueueAsync(DramatiqTasks.AnalyzeAudioJob, new object[] { jobId.ToString() }, ct);

        return Results.Ok(new UploadResponse(songGuid, versionId, jobId));
    }

    // GET /api/versions/{id}
    private static async Task<IResult> GetById(
        Guid versionId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var row = await (
            from v in db.SongVersions.AsNoTracking()
            join s in db.Songs.AsNoTracking() on v.SongId equals s.Id
            where v.Id == versionId && s.UserId == userId
            select v
        ).FirstOrDefaultAsync(ct);
        if (row is null) return Results.NotFound();
        return Results.Ok(new VersionDto(
            row.Id, row.SongId, row.VersionNumber, row.Label, row.IsCurrent, row.FilePath, row.CreatedAt));
    }

    // DELETE /api/versions/{id}
    private static async Task<IResult> Delete(
        Guid versionId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IFileStorage storage,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var row = await (
            from v in db.SongVersions
            join s in db.Songs on v.SongId equals s.Id
            where v.Id == versionId && s.UserId == userId
            select v
        ).FirstOrDefaultAsync(ct);
        if (row is null) return Results.NotFound();

        var key = row.FilePath;
        db.SongVersions.Remove(row);
        await db.SaveChangesAsync(ct);

        try { await storage.DeleteAsync(key, ct); }
        catch { /* best-effort — version row is gone, orphaned file is harmless */ }

        return Results.NoContent();
    }
}
