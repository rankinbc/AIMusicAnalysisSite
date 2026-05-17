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
        g.MapPatch("/{versionId:guid}", PatchVersion);
        g.MapPost("/{versionId:guid}/analyze", Reanalyze);
        g.MapPost("/{versionId:guid}/set-current", SetCurrent);
        g.MapGet("/{versionId:guid}/notes", ListNotes);
        g.MapPost("/{versionId:guid}/notes", CreateNote);
        g.MapPatch("/{versionId:guid}/notes/{noteId:guid}", PatchNote);
        g.MapDelete("/{versionId:guid}/notes/{noteId:guid}", DeleteNote);
        g.MapGet("/{versionId:guid}/audio", StreamAudio);

        return app;
    }

    // ── Shared ownership probe ───────────────────────────────────────────────
    // Returns true when the (versionId, userId) pair is valid. Used by every
    // sub-endpoint below to reject IDOR.
    private static Task<bool> UserOwnsVersion(
        AppDbContext db, Guid versionId, Guid userId, CancellationToken ct) =>
        (from v in db.SongVersions.AsNoTracking()
         join s in db.Songs.AsNoTracking() on v.SongId equals s.Id
         where v.Id == versionId && s.UserId == userId
         select v.Id).AnyAsync(ct);

    // ── PATCH /api/versions/{id} — rename label only (slice 1 scope) ────────
    private static async Task<IResult> PatchVersion(
        Guid versionId,
        PatchVersionRequest body,
        ClaimsPrincipal currentUser,
        AppDbContext db,
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

        if (body.Label is not null)
            row.Label = string.IsNullOrWhiteSpace(body.Label) ? null : body.Label.Trim();

        await db.SaveChangesAsync(ct);
        return Results.Ok(new VersionDto(
            row.Id, row.SongId, row.VersionNumber, row.Label, row.IsCurrent, row.FilePath, row.CreatedAt));
    }

    // ── POST /api/versions/{id}/analyze — re-enqueue audio analysis ─────────
    private static async Task<IResult> Reanalyze(
        Guid versionId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IJobQueue queue,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var version = await (
            from v in db.SongVersions.AsNoTracking()
            join s in db.Songs.AsNoTracking() on v.SongId equals s.Id
            where v.Id == versionId && s.UserId == userId
            select v
        ).FirstOrDefaultAsync(ct);
        if (version is null) return Results.NotFound();

        var jobId = Guid.NewGuid();
        db.AnalysisJobs.Add(new AnalysisJob
        {
            Id = jobId,
            UserId = userId,
            VersionId = versionId,
            Status = "pending",
        });
        await db.SaveChangesAsync(ct);
        await queue.EnqueueAsync(DramatiqTasks.AnalyzeAudioJob, new object[] { jobId.ToString() }, ct);
        return Results.Accepted(value: new ReanalyzeResponse(jobId));
    }

    // ── POST /api/versions/{id}/set-current ─────────────────────────────────
    private static async Task<IResult> SetCurrent(
        Guid versionId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var version = await (
            from v in db.SongVersions
            join s in db.Songs on v.SongId equals s.Id
            where v.Id == versionId && s.UserId == userId
            select v
        ).FirstOrDefaultAsync(ct);
        if (version is null) return Results.NotFound();

        // Demote any sibling currents, then promote this one. Single SQL pass
        // would be slightly faster but two ExecuteUpdateAsync calls are clear
        // and the songs-per-song row count is tiny.
        await db.SongVersions
            .Where(v => v.SongId == version.SongId && v.IsCurrent && v.Id != versionId)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.IsCurrent, false), ct);
        version.IsCurrent = true;
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    // ── Notes CRUD ──────────────────────────────────────────────────────────
    private static async Task<IResult> ListNotes(
        Guid versionId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        if (!await UserOwnsVersion(db, versionId, userId, ct)) return Results.NotFound();
        var notes = await db.SessionNotes.AsNoTracking()
            .Where(n => n.VersionId == versionId && n.UserId == userId)
            .OrderBy(n => n.TSeconds)
            .Select(n => new NoteDto(n.Id, n.VersionId, n.TSeconds, n.Text, n.Pinned, n.CreatedAt, n.UpdatedAt))
            .ToListAsync(ct);
        return Results.Ok(notes);
    }

    private static async Task<IResult> CreateNote(
        Guid versionId,
        CreateNoteRequest body,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        if (!await UserOwnsVersion(db, versionId, userId, ct)) return Results.NotFound();
        var trimmed = (body.Text ?? "").Trim();
        if (string.IsNullOrEmpty(trimmed))
            return Results.BadRequest(new { error = "Text is required." });
        if (trimmed.Length > 2000)
            return Results.BadRequest(new { error = "Text exceeds 2000 chars." });

        var row = new SessionNote
        {
            Id = Guid.NewGuid(),
            VersionId = versionId,
            UserId = userId,
            TSeconds = Math.Max(0, body.TSeconds),
            Text = trimmed,
            Pinned = body.Pinned,
        };
        db.SessionNotes.Add(row);
        await db.SaveChangesAsync(ct);
        return Results.Created(
            $"/api/versions/{versionId}/notes/{row.Id}",
            new NoteDto(row.Id, row.VersionId, row.TSeconds, row.Text, row.Pinned, row.CreatedAt, row.UpdatedAt));
    }

    private static async Task<IResult> PatchNote(
        Guid versionId,
        Guid noteId,
        PatchNoteRequest body,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var row = await db.SessionNotes
            .Where(n => n.Id == noteId && n.VersionId == versionId && n.UserId == userId)
            .FirstOrDefaultAsync(ct);
        if (row is null) return Results.NotFound();

        if (body.TSeconds is not null) row.TSeconds = Math.Max(0, body.TSeconds.Value);
        if (body.Text is not null)
        {
            var trimmed = body.Text.Trim();
            if (string.IsNullOrEmpty(trimmed))
                return Results.BadRequest(new { error = "Text cannot be empty." });
            if (trimmed.Length > 2000)
                return Results.BadRequest(new { error = "Text exceeds 2000 chars." });
            row.Text = trimmed;
        }
        if (body.Pinned is not null) row.Pinned = body.Pinned.Value;
        row.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return Results.Ok(new NoteDto(row.Id, row.VersionId, row.TSeconds, row.Text, row.Pinned, row.CreatedAt, row.UpdatedAt));
    }

    private static async Task<IResult> DeleteNote(
        Guid versionId,
        Guid noteId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var deleted = await db.SessionNotes
            .Where(n => n.Id == noteId && n.VersionId == versionId && n.UserId == userId)
            .ExecuteDeleteAsync(ct);
        return deleted > 0 ? Results.NoContent() : Results.NotFound();
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
