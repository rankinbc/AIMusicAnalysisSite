using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;

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
        g.MapGet("/{versionId:guid}/als", DownloadAls);
        g.MapGet("/{versionId:guid}/reference", DownloadReference);
        g.MapGet("/{versionId:guid}/files", GetFiles);
        g.MapPost("/{versionId:guid}/stems", UploadStems)
            .DisableAntiforgery()
            .WithMetadata(new RequestSizeLimitAttribute(MaxUploadBytes * 30));  // up to 30 stems (legacy role-keyed)

        // Bulk stem flow: stage (multi-file) -> classify (worker) -> poll -> confirm.
        g.MapPost("/{versionId:guid}/stems/stage", StageStems)
            .DisableAntiforgery()
            .WithMetadata(new RequestSizeLimitAttribute(MaxUploadBytes * 20));
        g.MapPost("/{versionId:guid}/stems/classify", ClassifyStems);
        g.MapGet("/{versionId:guid}/stems", GetStems);
        g.MapPost("/{versionId:guid}/stems/confirm", ConfirmStems);
        g.MapGet("/{versionId:guid}/stems/{stemId}/audio", StreamStemAudio);

        g.MapPost("/{versionId:guid}/als", UploadAls)
            .DisableAntiforgery()
            .WithMetadata(new RequestSizeLimitAttribute(50L * 1024 * 1024));    // .als files are small

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
            row.Id, row.SongId, row.VersionNumber, row.Label, row.IsCurrent, row.FilePath, row.CreatedAt,
            row.AlsFilePath, row.ReferencePath));
    }

    // ── POST /api/versions/{id}/analyze — re-enqueue audio analysis ─────────
    // Optional ?referenceId=<guid> drives Phase 5 against a saved library
    // reference (ownership-validated inside DispatchAnalysisAsync).
    private static async Task<IResult> Reanalyze(
        Guid versionId,
        [FromQuery] Guid? referenceId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IJobQueue queue,
        EntitlementService ents,
        CreditLedgerService credits,
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

        var (jobId, err) = await DispatchAnalysisAsync(userId, versionId, referenceId, db, ents, credits, queue, ct);
        if (err is not null) return err;
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

    // POST /api/versions  (multipart/form-data: file [required], song_id?, genre_hint?, analyze?)
    //
    // analyze defaults to true. The unified-upload flow sends analyze=false so the
    // version is created WITHOUT dispatching a job; a single analysis is dispatched
    // downstream (via /stems/confirm or /analyze). NOTE: bool? not bool — an absent
    // form field binds a non-nullable bool to false, which would break every existing
    // caller that omits the field. `?? true` preserves backward compatibility.
    private static async Task<IResult> UploadVersion(
        [FromForm] IFormFile file,
        [FromForm(Name = "song_id")] string? songId,
        [FromForm(Name = "genre_hint")] string? genreHint,
        [FromForm(Name = "analyze")] bool? analyze,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IFileStorage storage,
        IJobQueue queue,
        EntitlementService ents,
        CreditLedgerService credits,
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

        var shouldAnalyze = analyze ?? true;
        await db.SaveChangesAsync(ct);  // saves Song + SongVersion

        if (shouldAnalyze)
        {
            var (_, err) = await DispatchAnalysisAsync(userId, versionId, null, db, ents, credits, queue, ct, preallocatedJobId: jobId);
            if (err is not null) return err;
            return Results.Ok(new UploadResponse(songGuid, versionId, jobId));
        }

        return Results.Ok(new UploadResponse(songGuid, versionId, null));
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
            row.Id, row.SongId, row.VersionNumber, row.Label, row.IsCurrent, row.FilePath, row.CreatedAt,
            row.AlsFilePath, row.ReferencePath));
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

    // ── GET /api/versions/{id}/files — file manifest with existence + sizes ──
    private static async Task<IResult> GetFiles(
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

        var files = new List<VersionFileEntry>();

        // Mix audio
        var mixExt = Path.GetExtension(row.FilePath);
        files.Add(new VersionFileEntry(
            "mix",
            $"mix{mixExt}",
            await storage.GetFileSizeAsync(row.FilePath, ct),
            await storage.ExistsAsync(row.FilePath, ct)));

        // Ableton project
        if (!string.IsNullOrEmpty(row.AlsFilePath))
        {
            var alsExt = Path.GetExtension(row.AlsFilePath);
            files.Add(new VersionFileEntry(
                "als",
                $"project{alsExt}",
                await storage.GetFileSizeAsync(row.AlsFilePath, ct),
                await storage.ExistsAsync(row.AlsFilePath, ct)));
        }

        // Reference track
        if (!string.IsNullOrEmpty(row.ReferencePath))
        {
            var refExt = Path.GetExtension(row.ReferencePath);
            files.Add(new VersionFileEntry(
                "reference",
                $"reference{refExt}",
                await storage.GetFileSizeAsync(row.ReferencePath, ct),
                await storage.ExistsAsync(row.ReferencePath, ct)));
        }

        // Staged / confirmed stems (bulk flow)
        foreach (var entry in ReadRaw(row.StemPathsRaw))
        {
            files.Add(new VersionFileEntry(
                "stem",
                entry.OriginalFilename,
                await storage.GetFileSizeAsync(entry.Key, ct),
                await storage.ExistsAsync(entry.Key, ct),
                entry.Id));
        }

        return Results.Ok(new VersionFilesResponse(versionId, files));
    }

    // ── GET /api/versions/{id}/als — download the Ableton project file ───────
    private static async Task<IResult> DownloadAls(
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
        if (row is null || string.IsNullOrEmpty(row.AlsFilePath)) return Results.NotFound();
        if (!await storage.ExistsAsync(row.AlsFilePath, ct)) return Results.NotFound();

        var stream = await storage.OpenReadAsync(row.AlsFilePath, ct);
        return Results.File(stream, "application/octet-stream",
            fileDownloadName: Path.GetFileName(row.AlsFilePath),
            enableRangeProcessing: false);
    }

    // ── GET /api/versions/{id}/reference — download the reference audio ───────
    private static async Task<IResult> DownloadReference(
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
        if (row is null || string.IsNullOrEmpty(row.ReferencePath)) return Results.NotFound();
        if (!await storage.ExistsAsync(row.ReferencePath, ct)) return Results.NotFound();

        var stream = await storage.OpenReadAsync(row.ReferencePath, ct);
        var ext = Path.GetExtension(row.ReferencePath).ToLowerInvariant();
        var contentType = ext switch
        {
            ".wav" => "audio/wav",
            ".flac" => "audio/flac",
            ".mp3" => "audio/mpeg",
            _ => "application/octet-stream",
        };
        return Results.File(stream, contentType,
            fileDownloadName: Path.GetFileName(row.ReferencePath),
            enableRangeProcessing: false);
    }

    // ── POST /api/versions/{id}/stems ───────────────────────────────────────
    //
    // multipart/form-data with one file per role. The form field NAME is the
    // role slug (kick, bass, drums, lead, vocals, …) and the field VALUE is
    // the audio file. Stem-role names match `audio_analysis.stems.types.StemRole`.
    //
    // Persists the upload paths to `song_versions.stem_paths` (JSONB) and
    // kicks off a re-analysis so phase 4 / verdict pipeline pick up the
    // per-stem data.
    private static readonly HashSet<string> ValidStemRoles = new(StringComparer.OrdinalIgnoreCase)
    {
        "drums", "kick", "snare", "hats", "bass", "vocals", "lead", "pad", "fx", "other",
    };

    private static async Task<IResult> UploadStems(
        Guid versionId,
        HttpRequest request,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IFileStorage storage,
        IJobQueue queue,
        EntitlementService ents,
        CreditLedgerService credits,
        CancellationToken ct)
    {
        if (!request.HasFormContentType)
            return Results.BadRequest(new { error = "multipart/form-data required." });

        var userId = currentUser.UserId();
        var version = await (
            from v in db.SongVersions
            join s in db.Songs.AsNoTracking() on v.SongId equals s.Id
            where v.Id == versionId && s.UserId == userId
            select v
        ).FirstOrDefaultAsync(ct);
        if (version is null) return Results.NotFound();

        var form = await request.ReadFormAsync(ct);
        if (form.Files.Count == 0)
            return Results.BadRequest(new { error = "At least one stem file required." });
        if (form.Files.Count > 30)
            return Results.BadRequest(new { error = "Up to 30 stems per version." });

        // Merge with any prior stem map so the user can incrementally add roles
        // without losing earlier uploads (e.g. "add a lead stem to an existing
        // kick/bass set"). The new role-to-path entries overwrite earlier ones
        // with the same role, and orphaned files are left to be GCed later.
        var stemPaths = string.IsNullOrEmpty(version.StemPaths)
            ? new Dictionary<string, string>()
            : JsonSerializer.Deserialize<Dictionary<string, string>>(version.StemPaths)
                ?? new Dictionary<string, string>();

        foreach (var file in form.Files)
        {
            if (file.Length == 0) continue;
            var role = file.Name.ToLowerInvariant();
            if (!ValidStemRoles.Contains(role))
                return Results.BadRequest(new
                {
                    error = $"Unknown stem role '{file.Name}'. " +
                            "Use one of: drums, kick, snare, hats, bass, vocals, lead, pad, fx, other.",
                });
            var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (string.IsNullOrEmpty(ext)) ext = ".bin";
            var key = $"audio/stems/{versionId}/{role}{ext}";
            await using var src = file.OpenReadStream();
            await storage.WriteAsync(key, src,
                file.ContentType ?? "application/octet-stream", ct);
            stemPaths[role] = key;
        }

        version.StemPaths = JsonSerializer.Serialize(stemPaths);
        version.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);

        var (jobId, err) = await DispatchAnalysisAsync(userId, versionId, null, db, ents, credits, queue, ct);
        if (err is not null) return err;
        return Results.Ok(new StemUploadResponse(versionId, stemPaths, jobId));
    }

    // ── POST /api/versions/{id}/als ─────────────────────────────────────────
    //
    // Single .als file. Persists to `song_versions.als_file_path` and kicks
    // off a re-analysis so phase 8 (ALS) populates project-health data.
    private static async Task<IResult> UploadAls(
        Guid versionId,
        [FromForm] IFormFile file,
        [FromForm(Name = "analyze")] bool? analyze,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IFileStorage storage,
        IJobQueue queue,
        EntitlementService ents,
        CreditLedgerService credits,
        CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            return Results.BadRequest(new { error = "Empty file." });
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (ext != ".als" && ext != ".gz")
            return Results.BadRequest(new { error = ".als (or gzip-compressed) file required." });

        var userId = currentUser.UserId();
        // MUST be a tracked query: `db.Songs.AsNoTracking()` in the join would make
        // the WHOLE query no-tracking, so `version.AlsFilePath = key; SaveChanges()`
        // below would be silently dropped (the .als file lands in storage but the
        // column stays null → phase 8 never sees it). Use the tracked OwnedVersion
        // helper, matching the stems write path.
        var version = await OwnedVersion(db, versionId, userId, ct);
        if (version is null) return Results.NotFound();

        var key = $"audio/als/{versionId}/project{ext}";
        await using (var src = file.OpenReadStream())
        {
            await storage.WriteAsync(key, src,
                file.ContentType ?? "application/octet-stream", ct);
        }

        version.AlsFilePath = key;
        version.UpdatedAt = DateTimeOffset.UtcNow;

        // analyze defaults to true (re-run pipeline so phase 8 picks up the .als).
        // The unified-upload flow sends analyze=false: attach the project only and
        // let the single downstream dispatch do the one analysis. bool? + `?? true`
        // keeps existing callers (who omit the field) on the analyze path.
        var shouldAnalyze = analyze ?? true;
        await db.SaveChangesAsync(ct);  // saves version.AlsFilePath update

        if (shouldAnalyze)
        {
            var (jobId, err) = await DispatchAnalysisAsync(userId, versionId, null, db, ents, credits, queue, ct);
            if (err is not null) return err;
            return Results.Ok(new AlsUploadResponse(versionId, key, jobId));
        }

        return Results.Ok(new AlsUploadResponse(versionId, key, null));
    }

    // ════════════════════════════════════════════════════════════════════════
    // Bulk stem upload: stage (multi-file) → classify (worker actor) → poll → confirm.
    // The classifier is Python (the worker); the BFF only stages files + enqueues.
    // ════════════════════════════════════════════════════════════════════════
    private const int MaxStems = 100;
    private static readonly HashSet<string> StemAudioExts =
        new(StringComparer.OrdinalIgnoreCase) { ".wav", ".flac" };

    // Persisted shape of song_versions.stem_paths_raw. JsonPropertyName forces
    // snake_case keys so the Python worker (classify_stems / phase4) reads them.
    private sealed class StemRawEntry
    {
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        [JsonPropertyName("original_filename")] public string OriginalFilename { get; set; } = "";
        [JsonPropertyName("path")] public string Key { get; set; } = "";
        [JsonPropertyName("detected_role")] public string? DetectedRole { get; set; }
        [JsonPropertyName("confidence")] public double Confidence { get; set; }
        [JsonPropertyName("evidence")] public string? Evidence { get; set; }
        [JsonPropertyName("confirmed_role")] public string? ConfirmedRole { get; set; }
    }

    private static List<StemRawEntry> ReadRaw(string? json) =>
        string.IsNullOrEmpty(json)
            ? new List<StemRawEntry>()
            : JsonSerializer.Deserialize<List<StemRawEntry>>(json) ?? new List<StemRawEntry>();

    private static StemRawDto ToDto(StemRawEntry e) =>
        new(e.Id, e.OriginalFilename, e.DetectedRole, e.Confidence, e.Evidence, e.ConfirmedRole);

    // NOTE: no AsNoTracking — stage/confirm write through the returned entity, and
    // AsNoTracking anywhere in a query makes the WHOLE query no-tracking, which would
    // silently drop SaveChanges updates. The read-only callers tracking a row is harmless.
    private static async Task<SongVersion?> OwnedVersion(
        AppDbContext db, Guid versionId, Guid userId, CancellationToken ct) =>
        await (from v in db.SongVersions
               join s in db.Songs on v.SongId equals s.Id
               where v.Id == versionId && s.UserId == userId
               select v).FirstOrDefaultAsync(ct);

    // Magic-byte check (not Content-Type, which is spoofable): RIFF (wav) / fLaC (flac).
    private static async Task<bool> LooksLikeAudioAsync(Stream s, CancellationToken ct)
    {
        if (!s.CanSeek) return true; // can't peek — fall back to the extension check
        var buf = new byte[4];
        var n = await s.ReadAsync(buf.AsMemory(0, 4), ct);
        s.Position = 0;
        if (n < 4) return false;
        return (buf[0] == (byte)'R' && buf[1] == (byte)'I' && buf[2] == (byte)'F' && buf[3] == (byte)'F')
            || (buf[0] == (byte)'f' && buf[1] == (byte)'L' && buf[2] == (byte)'a' && buf[3] == (byte)'C');
    }

    // POST /api/versions/{id}/stems/stage — append staged stems (call once or in batches).
    private static async Task<IResult> StageStems(
        Guid versionId, HttpRequest request, ClaimsPrincipal currentUser,
        AppDbContext db, IFileStorage storage, CancellationToken ct)
    {
        if (!request.HasFormContentType)
            return Results.BadRequest(new { error = "multipart/form-data required." });
        var userId = currentUser.UserId();
        var version = await OwnedVersion(db, versionId, userId, ct);
        if (version is null) return Results.NotFound();

        var form = await request.ReadFormAsync(ct);
        if (form.Files.Count == 0)
            return Results.BadRequest(new { error = "At least one stem file required." });

        var entries = ReadRaw(version.StemPathsRaw);
        if (entries.Count + form.Files.Count > MaxStems)
            return Results.BadRequest(new { error = $"Up to {MaxStems} stems per version." });

        foreach (var file in form.Files)
        {
            if (file.Length == 0) continue;
            if (file.Length > MaxUploadBytes)
                return Results.BadRequest(new { error = $"'{file.FileName}' exceeds the 250 MB limit." });
            var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (!StemAudioExts.Contains(ext))
                return Results.BadRequest(new { error = $"'{file.FileName}': only .wav / .flac stems are supported." });

            await using var src = file.OpenReadStream();
            if (!await LooksLikeAudioAsync(src, ct))
                return Results.BadRequest(new { error = $"'{file.FileName}' is not a valid WAV/FLAC file." });

            var stemId = Guid.NewGuid().ToString();
            var key = $"audio/stems/{versionId}/{stemId}{ext}";
            await storage.WriteAsync(key, src, file.ContentType ?? "application/octet-stream", ct);
            entries.Add(new StemRawEntry { Id = stemId, OriginalFilename = file.FileName, Key = key });
        }

        version.StemPathsRaw = JsonSerializer.Serialize(entries);
        version.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return Results.Ok(new StageStemsResponse(versionId, entries.Select(ToDto).ToList()));
    }

    // POST /api/versions/{id}/stems/classify — enqueue audio-content classification.
    private static async Task<IResult> ClassifyStems(
        Guid versionId, ClaimsPrincipal currentUser, AppDbContext db, IJobQueue queue, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        if (!await UserOwnsVersion(db, versionId, userId, ct)) return Results.NotFound();
        // Story 2.5: paid-feature work → analysis-paid (W1). Free tier has stems=false.
        await queue.EnqueueAsync(
            DramatiqTasks.ClassifyStems, new object[] { versionId.ToString() },
            DramatiqQueues.AnalysisPaid, ct);
        return Results.Accepted(value: new { queued = true });
    }

    // GET /api/versions/{id}/stems — poll proposals; classified=true when the worker has finished.
    private static async Task<IResult> GetStems(
        Guid versionId, ClaimsPrincipal currentUser, AppDbContext db, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var version = await OwnedVersion(db, versionId, userId, ct);
        if (version is null) return Results.NotFound();
        var entries = ReadRaw(version.StemPathsRaw);
        var classified = entries.Count > 0 && entries.All(e => !string.IsNullOrEmpty(e.DetectedRole));
        return Results.Ok(new StemProposalsResponse(versionId, classified, entries.Select(ToDto).ToList()));
    }

    // POST /api/versions/{id}/stems/confirm — persist confirmed roles + groups, dispatch re-analysis.
    private static async Task<IResult> ConfirmStems(
        Guid versionId, ConfirmStemsRequest body, ClaimsPrincipal currentUser,
        AppDbContext db, IJobQueue queue, EntitlementService ents, CreditLedgerService credits, CancellationToken ct)
    {
        if (body?.Stems is null || body.Stems.Count == 0)
            return Results.BadRequest(new { error = "At least one stem confirmation required." });
        var userId = currentUser.UserId();
        var version = await OwnedVersion(db, versionId, userId, ct);
        if (version is null) return Results.NotFound();

        var entries = ReadRaw(version.StemPathsRaw);
        if (entries.Count == 0)
            return Results.BadRequest(new { error = "No staged stems to confirm." });
        var byId = entries.ToDictionary(e => e.Id);

        foreach (var item in body.Stems)
        {
            var role = (item.ConfirmedRole ?? "").ToLowerInvariant();
            if (!ValidStemRoles.Contains(role))
                return Results.BadRequest(new { error = $"Unknown stem role '{item.ConfirmedRole}'." });
            if (!byId.TryGetValue(item.Id, out var entry))
                return Results.BadRequest(new { error = $"Unknown stem id '{item.Id}'." });
            entry.ConfirmedRole = role;
        }

        // role -> [paths] groups from confirmed entries (consumed by the grouped analyzer).
        var groups = new Dictionary<string, List<string>>();
        foreach (var e in entries.Where(e => !string.IsNullOrEmpty(e.ConfirmedRole)))
        {
            if (!groups.TryGetValue(e.ConfirmedRole!, out var list))
                groups[e.ConfirmedRole!] = list = new List<string>();
            list.Add(e.Key);
        }
        if (groups.Count == 0)
            return Results.BadRequest(new { error = "No confirmed stems." });

        version.StemPathsRaw = JsonSerializer.Serialize(entries);
        version.StemPaths = JsonSerializer.Serialize(groups);
        version.StemAnalysisMode = body.Mode == "per_stem" ? "per_stem" : "grouped";
        version.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);

        var (jobId, err) = await DispatchAnalysisAsync(userId, versionId, body.ReferenceId, db, ents, credits, queue, ct);
        if (err is not null) return err;
        return Results.Ok(new ConfirmStemsResponse(versionId, jobId));
    }

    // GET /api/versions/{id}/stems/{stemId}/audio — Range-enabled preview (JWT via ?t= works:
    // the path contains "/audio", which the JwtBearer OnMessageReceived hook whitelists).
    private static async Task<IResult> StreamStemAudio(
        Guid versionId, string stemId, ClaimsPrincipal currentUser,
        AppDbContext db, IFileStorage storage, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var version = await OwnedVersion(db, versionId, userId, ct);
        if (version is null) return Results.NotFound();
        var entry = ReadRaw(version.StemPathsRaw).FirstOrDefault(e => e.Id == stemId);
        if (entry is null || !await storage.ExistsAsync(entry.Key, ct)) return Results.NotFound();
        var stream = await storage.OpenReadAsync(entry.Key, ct);
        var ext = Path.GetExtension(entry.Key).ToLowerInvariant();
        var contentType = ext == ".wav" ? "audio/wav" : ext == ".flac" ? "audio/flac" : "application/octet-stream";
        return Results.File(stream, contentType, enableRangeProcessing: true);
    }

    // ── Story 2.4: Entitlement-gated dispatch ───────────────────────────────
    // Single authoritative dispatch path. All 5 analyze-dispatch sites route
    // through here. Never called by result-read handlers (AR15).
    //
    // preallocatedJobId: pass when the caller already used the jobId in a
    // storage key (e.g. UploadVersion: "audio/upload/{jobId}/...").
    private static async Task<(Guid JobId, IResult? Error)> DispatchAnalysisAsync(
        Guid userId,
        Guid versionId,
        Guid? referenceId,
        AppDbContext db,
        EntitlementService ents,
        CreditLedgerService credits,
        IJobQueue queue,
        CancellationToken ct,
        Guid? preallocatedJobId = null)
    {
        // IDOR guard: a caller-supplied reference must belong to this user.
        // Centralized here so every dispatch site is covered (AR15 keeps reads out).
        if (referenceId is not null)
        {
            var refOwned = await db.ReferenceTracks
                .AsNoTracking()
                .AnyAsync(r => r.Id == referenceId.Value && r.UserId == userId, ct);
            if (!refOwned)
                return (Guid.Empty, ErrorEnvelope.Build(404, "reference_not_found",
                    "Reference track not found."));
        }

        EntitlementsDto ent;
        try
        {
            ent = await ents.ForAsync(userId, ct);
        }
        catch (Exception)
        {
            return (Guid.Empty, ErrorEnvelope.Build(503, "entitlements_unavailable",
                "Entitlement service temporarily unavailable."));
        }

        if (ent.AnalysesRemaining == 0)
            return (Guid.Empty, ErrorEnvelope.Build(409, "entitlement_exhausted",
                "You have used all your analyses for this billing period."));

        var jobId = preallocatedJobId ?? Guid.NewGuid();
        var billingPeriod = DateTimeOffset.UtcNow.ToString("yyyy-MM");

        if (ent.Tier == "credits")
        {
            // Insert job first (outside Serializable TX), then spend atomically.
            var job = new AnalysisJob
            {
                Id = jobId,
                UserId = userId,
                VersionId = versionId,
                ReferenceId = referenceId,
                Tier = "credits",
                Status = "pending",
            };
            db.AnalysisJobs.Add(job);
            await db.SaveChangesAsync(ct);

            try
            {
                await credits.SpendAsync(userId, jobId, billingPeriod, ct);
            }
            catch (InsufficientCreditsException)
            {
                // Race: balance hit 0 between entitlement check and spend.
                job.Status = "failed";
                job.ErrorCode = "insufficient_credits";
                job.FailedAt = DateTimeOffset.UtcNow;
                await db.SaveChangesAsync(ct);
                return (Guid.Empty, ErrorEnvelope.Build(409, "insufficient_credits",
                    "Insufficient credits."));
            }
        }
        else
        {
            // Free / Pro: atomic insert of job + usage event (single EF SaveChanges = implicit TX).
            db.AnalysisJobs.Add(new AnalysisJob
            {
                Id = jobId,
                UserId = userId,
                VersionId = versionId,
                ReferenceId = referenceId,
                Tier = ent.Tier,
                Status = "pending",
            });
            db.UsageEvents.Add(new UsageEvent
            {
                UserId = userId,
                EventType = "analysis",
                BillingPeriod = billingPeriod,
                Reference = jobId.ToString(),
            });
            await db.SaveChangesAsync(ct);
        }

        // Enqueue AFTER transaction commits (AR13: worker reads tier from job row).
        // Story 2.5: tier-route so paid/credit jobs never starve behind the free flood.
        // Route off ent.Tier (the resolver's authoritative value, already in hand) — not a
        // re-read of job.Tier. analyze_audio_job is consumed from BOTH lanes (W1 + W2); the
        // queue here is the real router (Dramatiq dispatches by actor_name on arrival).
        var queueName = ent.Tier switch
        {
            "pro"     => DramatiqQueues.AnalysisPaid,
            "credits" => DramatiqQueues.AnalysisPaid,
            _         => DramatiqQueues.AnalysisFree, // "free", null, future anonymous
        };
        await queue.EnqueueAsync(
            DramatiqTasks.AnalyzeAudioJob,
            new object[] { jobId.ToString() },
            queueName,
            ct);
        return (jobId, null);
    }
}
