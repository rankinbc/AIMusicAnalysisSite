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

        // Task D6 (spec D4) — the guest's one upload lives on THIS route.
        g.MapPost("/", UploadVersion)
            .DisableAntiforgery()
            .WithMetadata(new RequestSizeLimitAttribute(MaxUploadBytes))
            .AllowGuestUpload();

        g.MapGet("/{versionId:guid}", GetById);
        // Task G1 (ruling R7): a guest may delete their own version. WHY this
        // is still safe under the upload quota: a delete can lower the
        // version DB count, but the upload quota is enforced by the ATOMIC
        // upload-slot ledger (GuestLimits.Uploads.cs, FW1) — a committed
        // upload's slot is never refunded on delete — plus the analysis count is append-only
        // usage_events. Neither bound is reset by removing a row, so
        // delete+reupload cannot mint extra quota.
        g.MapDelete("/{versionId:guid}", Delete).AllowGuest();
        g.MapPatch("/{versionId:guid}", PatchVersion).AllowGuest();
        g.MapPost("/{versionId:guid}/analyze", Reanalyze).AllowGuest(); // quota enforced inside DispatchAnalysisAsync
        g.MapPost("/{versionId:guid}/set-current", SetCurrent).AllowGuest();
        g.MapGet("/{versionId:guid}/notes", ListNotes);
        g.MapPost("/{versionId:guid}/notes", CreateNote).AllowGuest();
        g.MapPatch("/{versionId:guid}/notes/{noteId:guid}", PatchNote).AllowGuest();
        g.MapDelete("/{versionId:guid}/notes/{noteId:guid}", DeleteNote).AllowGuest();
        g.MapGet("/{versionId:guid}/audio", StreamAudio);
        g.MapGet("/{versionId:guid}/als", DownloadAls);
        g.MapGet("/{versionId:guid}/reference", DownloadReference);
        g.MapGet("/{versionId:guid}/files", GetFiles);
        g.MapPost("/{versionId:guid}/stems", UploadStems)
            .DisableAntiforgery()
            .WithMetadata(new RequestSizeLimitAttribute(MaxUploadBytes * 30));  // up to 30 stems (legacy role-keyed)

        // Bulk stem flow: stage (multi-file) -> classify (worker) -> poll -> confirm.
        // Task G1 — guests get the bulk stem flow (under CheckStemsAsync caps
        // enforced inside the handlers); the legacy role-keyed UploadStems
        // above stays closed.
        g.MapPost("/{versionId:guid}/stems/stage", StageStems)
            .DisableAntiforgery()
            .WithMetadata(new RequestSizeLimitAttribute(MaxUploadBytes * 20))
            .AllowGuest();
        g.MapPost("/{versionId:guid}/stems/classify", ClassifyStems).AllowGuest();
        g.MapGet("/{versionId:guid}/stems", GetStems);
        g.MapPost("/{versionId:guid}/stems/confirm", ConfirmStems).AllowGuest();
        g.MapGet("/{versionId:guid}/stems/{stemId}/audio", StreamStemAudio);

        g.MapPost("/{versionId:guid}/als", UploadAls)
            .DisableAntiforgery()
            .WithMetadata(new RequestSizeLimitAttribute(50L * 1024 * 1024))    // .als files are small
            .AllowGuest();

        // Story 3.2 — register attachments already PUT to object storage via
        // the presigned path (/uploads/attachments/init). JSON-only (no bytes).
        // Task G1 — guests get the presigned stems/.als registration too
        // (CheckStemsAsync applies the same cap as the proxy-upload path).
        g.MapPost("/{versionId:guid}/stems/stage-keys", StageStemKeys).AllowGuest();
        g.MapPost("/{versionId:guid}/als-key", RegisterAlsKey).AllowGuest();

        // Personal score — per-user × per-version rating (Change B)
        g.MapPut("/{versionId:guid}/rating", SetRating).AllowGuest();
        g.MapDelete("/{versionId:guid}/rating", ClearRating).AllowGuest();

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
        HttpContext httpCtx,
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

        var (jobId, err) = await DispatchAnalysisAsync(userId, versionId, referenceId, db, ents, credits, queue, httpCtx, ct);
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
    // Owner-only (solo fork): 404 for anyone else — existence must not leak.
    private static async Task<IResult> StreamAudio(
        Guid versionId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IFileStorage storage,
        IMultipartObjectStore objectStore,
        HttpResponse response,
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

        // Story 3.3: local-first proxy, else 302 to a short-lived presigned GET.
        return await MediaDelivery.ServeAsync(
            storage, objectStore, row.FilePath, MediaDelivery.AudioContentType(row.FilePath),
            response, ct);
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
        HttpContext httpCtx,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        if (file is null || file.Length == 0)
            return Results.BadRequest(new { error = "Empty file." });
        if (file.Length > MaxUploadBytes)
            return Results.BadRequest(new { error = "File exceeds 250 MB limit." });

        var (songGuid, songErr) = await ResolveOrCreateSongAsync(db, userId, songId, genreHint, file.FileName, ct);
        if (songErr is not null) return songErr;

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

        var versionId = await InsertVersionRowAsync(db, songGuid, key, ct);

        var shouldAnalyze = analyze ?? true;
        try
        {
            await db.SaveChangesAsync(ct);  // saves Song + SongVersion
        }
        catch (DbUpdateException ex) when (DbViolations.IsUniqueViolation(ex))
        {
            // Wave-2 (E3.2) — race-only residual (auto-suffix probe vs concurrent
            // insert). The audio object was written above with NO DB row pointing
            // at it — best-effort cleanup; never let cleanup mask the 409.
            try { await storage.DeleteAsync(key, ct); }
            catch { /* orphaned object is retention's problem */ }
            return ErrorEnvelope.Build(409, "song_name_conflict",
                "A song with that name already exists. Pick it from the song list or rename.");
        }
        GuestLimits.MarkUploadCommitted(httpCtx); // FW1 (I1): a guest keeps the slot the guard charged

        if (shouldAnalyze)
        {
            var (_, err) = await DispatchAnalysisAsync(userId, versionId, null, db, ents, credits, queue, httpCtx, ct, preallocatedJobId: jobId);
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

        var latestJobId = await db.Analyses.AsNoTracking()
            .Where(a => a.UserId == userId && a.VersionId == versionId)
            .OrderByDescending(a => a.CreatedAt)
            .ThenByDescending(a => a.Id) // deterministic when two rows share a timestamp
            .Select(a => (Guid?)a.JobId)
            .FirstOrDefaultAsync(ct);

        return Results.Ok(new VersionDto(
            row.Id, row.SongId, row.VersionNumber, row.Label, row.IsCurrent, row.FilePath, row.CreatedAt,
            row.AlsFilePath, row.ReferencePath, LatestJobId: latestJobId));
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

        // DeleteUnlessSharedAsync — a seeded demo version's FilePath can point
        // at the shared "audio/demo/" blob; never delete that out from under
        // every other seeded account.
        try { await storage.DeleteUnlessSharedAsync(key, ct); }
        catch { /* best-effort — version row is gone, orphaned file is harmless */ }

        return Results.NoContent();
    }

    // ── GET /api/versions/{id}/files — file manifest with existence + sizes ──
    private static async Task<IResult> GetFiles(
        Guid versionId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IFileStorage storage,
        IMultipartObjectStore objectStore,
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

        // Story 3.3 — availability = local OR object storage. Without the S3
        // arm, every S3-only file shows "Expired" in FilesTab and the new
        // presigned download path is unreachable from the UI.
        async Task<(long? Size, bool Exists)> ProbeAsync(string key)
        {
            if (await storage.ExistsAsync(key, ct))
                return (await storage.GetFileSizeAsync(key, ct), true);
            if (objectStore.IsConfigured)
            {
                var size = await objectStore.GetObjectSizeAsync(key, ct);
                if (size is not null) return (size, true);
            }
            return (null, false);
        }

        var files = new List<VersionFileEntry>();

        // Mix audio
        var mixExt = Path.GetExtension(row.FilePath);
        var mix = await ProbeAsync(row.FilePath);
        files.Add(new VersionFileEntry("mix", $"mix{mixExt}", mix.Size, mix.Exists));

        // Ableton project
        if (!string.IsNullOrEmpty(row.AlsFilePath))
        {
            var alsExt = Path.GetExtension(row.AlsFilePath);
            var als = await ProbeAsync(row.AlsFilePath);
            files.Add(new VersionFileEntry("als", $"project{alsExt}", als.Size, als.Exists));
        }

        // Reference track
        if (!string.IsNullOrEmpty(row.ReferencePath))
        {
            var refExt = Path.GetExtension(row.ReferencePath);
            var reference = await ProbeAsync(row.ReferencePath);
            files.Add(new VersionFileEntry("reference", $"reference{refExt}", reference.Size, reference.Exists));
        }

        // Staged / confirmed stems (bulk flow)
        foreach (var entry in ReadRaw(row.StemPathsRaw))
        {
            var stem = await ProbeAsync(entry.Key);
            files.Add(new VersionFileEntry("stem", entry.OriginalFilename, stem.Size, stem.Exists, entry.Id));
        }

        return Results.Ok(new VersionFilesResponse(versionId, files));
    }

    // ── GET /api/versions/{id}/als — download the Ableton project file ───────
    private static async Task<IResult> DownloadAls(
        Guid versionId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IFileStorage storage,
        IMultipartObjectStore objectStore,
        HttpResponse response,
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

        return await MediaDelivery.ServeAsync(
            storage, objectStore, row.AlsFilePath, "application/octet-stream", response, ct,
            rangeProcessing: false, downloadName: Path.GetFileName(row.AlsFilePath));
    }

    // ── GET /api/versions/{id}/reference — download the reference audio ───────
    private static async Task<IResult> DownloadReference(
        Guid versionId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IFileStorage storage,
        IMultipartObjectStore objectStore,
        HttpResponse response,
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

        return await MediaDelivery.ServeAsync(
            storage, objectStore, row.ReferencePath,
            MediaDelivery.AudioContentType(row.ReferencePath), response, ct,
            rangeProcessing: false, downloadName: Path.GetFileName(row.ReferencePath));
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
        HttpContext httpCtx,
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

        var (jobId, err) = await DispatchAnalysisAsync(userId, versionId, null, db, ents, credits, queue, httpCtx, ct);
        if (err is not null) return err;
        return Results.Ok(new StemUploadResponse(versionId, stemPaths, jobId));
    }

    // ── POST /api/versions/{id}/als ─────────────────────────────────────────
    //
    // Single .als file. Persists to `song_versions.als_file_path` and kicks
    // off a re-analysis so phase 8 (ALS) populates project-health data.
    // Cap the client-supplied project JSON so an oversized/abusive payload can't
    // bloat the row. The frontend caps tracks/devices too; this is the backstop.
    private const int MaxProjectJsonBytes = 512 * 1024;

    private static async Task<IResult> UploadAls(
        Guid versionId,
        [FromForm] IFormFile file,
        [FromForm(Name = "analyze")] bool? analyze,
        [FromForm(Name = "project_json")] string? projectJson,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IFileStorage storage,
        IJobQueue queue,
        EntitlementService ents,
        CreditLedgerService credits,
        HttpContext httpCtx,
        CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            return Results.BadRequest(new { error = "Empty file." });
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (ext != ".als" && ext != ".gz")
            return Results.BadRequest(new { error = ".als (or gzip-compressed) file required." });

        // Validate the optional project map: size-bounded + must parse as a JSON
        // object. It's client-supplied metadata (project awareness), not trusted
        // for analysis — the worker's phase8 re-parse stays authoritative.
        string? normalizedProjectJson = null;
        if (!string.IsNullOrWhiteSpace(projectJson))
        {
            if (System.Text.Encoding.UTF8.GetByteCount(projectJson) > MaxProjectJsonBytes)
                return Results.BadRequest(new { error = "Project metadata is too large." });
            try
            {
                using var probe = JsonDocument.Parse(projectJson);
                if (probe.RootElement.ValueKind != JsonValueKind.Object)
                    return Results.BadRequest(new { error = "project_json must be a JSON object." });
            }
            catch (JsonException)
            {
                return Results.BadRequest(new { error = "project_json is not valid JSON." });
            }
            normalizedProjectJson = projectJson;
        }

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
        if (normalizedProjectJson is not null) version.AlsProjectJson = normalizedProjectJson;
        version.UpdatedAt = DateTimeOffset.UtcNow;

        // analyze defaults to true (re-run pipeline so phase 8 picks up the .als).
        // The unified-upload flow sends analyze=false: attach the project only and
        // let the single downstream dispatch do the one analysis. bool? + `?? true`
        // keeps existing callers (who omit the field) on the analyze path.
        var shouldAnalyze = analyze ?? true;
        await db.SaveChangesAsync(ct);  // saves version.AlsFilePath update

        if (shouldAnalyze)
        {
            var (jobId, err) = await DispatchAnalysisAsync(userId, versionId, null, db, ents, credits, queue, httpCtx, ct);
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
    // Task G1 — internal (was private): UploadEndpoints.AttachmentInit reuses
    // this shape + ReadRaw/SumStemBytesAsync to apply the same guest stems
    // cap to the presigned single-attachment path.
    internal sealed class StemRawEntry
    {
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        [JsonPropertyName("original_filename")] public string OriginalFilename { get; set; } = "";
        [JsonPropertyName("path")] public string Key { get; set; } = "";
        [JsonPropertyName("detected_role")] public string? DetectedRole { get; set; }
        [JsonPropertyName("confidence")] public double Confidence { get; set; }
        [JsonPropertyName("evidence")] public string? Evidence { get; set; }
        [JsonPropertyName("confirmed_role")] public string? ConfirmedRole { get; set; }
    }

    internal static List<StemRawEntry> ReadRaw(string? json) =>
        string.IsNullOrEmpty(json)
            ? new List<StemRawEntry>()
            : JsonSerializer.Deserialize<List<StemRawEntry>>(json) ?? new List<StemRawEntry>();

    private static StemRawDto ToDto(StemRawEntry e) =>
        new(e.Id, e.OriginalFilename, e.DetectedRole, e.Confidence, e.Evidence, e.ConfirmedRole);

    // Task G1 — total byte size of already-staged stems, for the guest stems
    // cap (CheckStemsAsync). A missing/orphaned blob counts as 0 rather than
    // failing the whole request — this is a best-effort cap, not a strict
    // accounting ledger.
    // Fix round 1 item 3 — a stem staged via the presigned path (stage-keys)
    // lives ONLY in object storage, never on local IFileStorage; without the
    // fallback below every such entry read back as 0 bytes, so the 300 MB cap
    // only ever applied per-request. Same ExistsAsync-then-Probe shape as
    // GetFiles' ProbeAsync.
    internal static async Task<long> SumStemBytesAsync(
        IEnumerable<StemRawEntry> entries, IFileStorage storage, IMultipartObjectStore store, CancellationToken ct)
    {
        long total = 0;
        foreach (var e in entries)
        {
            var size = await storage.GetFileSizeAsync(e.Key, ct);
            if (size is null && store.IsConfigured)
                size = await store.GetObjectSizeAsync(e.Key, ct);
            total += size ?? 0;
        }
        return total;
    }

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
        AppDbContext db, IFileStorage storage, IMultipartObjectStore store, GuestLimits limits, CancellationToken ct)
    {
        if (!request.HasFormContentType)
            return Results.BadRequest(new { error = "multipart/form-data required." });
        var userId = currentUser.UserId();
        var isGuest = currentUser.IsGuest();

        // Fix round 1 item 4(a) — reject an over-budget guest body from its
        // Content-Length BEFORE the form is read: ReadFormAsync buffers the
        // WHOLE multipart body first (the route's own size limit is ~5 GB),
        // so a capped-out guest could otherwise push gigabytes into temp
        // storage per request and still land a tidy 403. A non-tracking
        // probe of the version's current staged bytes — reads no
        // request-body bytes, only a DB row.
        if (isGuest)
        {
            var stagedJson = await db.SongVersions.AsNoTracking()
                .Where(v => v.Id == versionId && db.Songs.Any(s => s.Id == v.SongId && s.UserId == userId))
                .Select(v => v.StemPathsRaw)
                .FirstOrDefaultAsync(ct);
            var existingForBudget = await SumStemBytesAsync(ReadRaw(stagedJson), storage, store, ct);
            if (await limits.CheckStemsContentLengthAsync(existingForBudget, request.ContentLength, ct) is { } tooLarge)
                return tooLarge;
        }

        // Fix round 1 item 4(b) — stems/stage is check-then-write on
        // song_versions.stem_paths_raw; N parallel guest requests each read
        // the SAME "before" state and can all pass CheckStemsAsync below,
        // or clobber each other's writes outright (no concurrency token on
        // this column). A short-lived per-guest Redis lock serialises one
        // guest's OWN stage calls. Real users are unaffected — no lock.
        string? lockToken = null;
        if (isGuest)
        {
            var lockResult = await limits.AcquireStemsLockAsync(userId, ct);
            if (!lockResult.Ok) return lockResult.Error!;
            lockToken = lockResult.Token;
        }
        try
        {
            var version = await OwnedVersion(db, versionId, userId, ct);
            if (version is null) return Results.NotFound();

            var form = await request.ReadFormAsync(ct);
            if (form.Files.Count == 0)
                return Results.BadRequest(new { error = "At least one stem file required." });

            // Task G7a (R2) — the lock above has a 120s TTL; on a slow
            // upload it can expire mid-read, letting a second request in and
            // out while this one is still parsing its (possibly large)
            // multipart body. `version` was loaded BEFORE that read, so its
            // in-memory StemPathsRaw can be stale by now. Reload the tracked
            // entity from the DB (not a re-query — EF's identity map would
            // just hand back the same stale in-memory instance) so the count
            // check and the eventual write are both based on the CURRENT row.
            await db.Entry(version).ReloadAsync(ct);

            var entries = ReadRaw(version.StemPathsRaw);

            // Task G1 — the guest stems cap (count + total bytes), checked
            // before anything is written to storage. This is the PRECISE
            // check (against a fresh read taken under the lock); the
            // Content-Length probe above is only a cheap upper-bound proxy.
            if (isGuest)
            {
                var addBytes = form.Files.Where(f => f.Length > 0).Sum(f => f.Length);
                var existingBytes = await SumStemBytesAsync(entries, storage, store, ct);
                if (await limits.CheckStemsAsync(entries.Count, existingBytes, form.Files.Count, addBytes, ct) is { } denied)
                    return denied;
            }

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
        finally
        {
            if (lockToken is not null)
                await limits.ReleaseStemsLockAsync(userId, lockToken);
        }
    }

    // ── Story 3.2 — presigned-attachment registration (JSON, no file bytes) ──

    public sealed record StageStemKeyItem(string StemId, string Key, string FileName);
    public sealed record StageStemKeysRequest(List<StageStemKeyItem> Stems);
    public sealed record RegisterAlsKeyRequest(string Key, string? ProjectJson, bool? Analyze);

    // POST /api/versions/{id}/stems/stage-keys — register stems the client PUT
    // directly to object storage. Trust chain: key prefix must be the AR20
    // stems/{jobId}/ prefix for THIS version's jobId (derived server-side from
    // the source key, never the client), and each object must actually exist.
    private static async Task<IResult> StageStemKeys(
        Guid versionId, StageStemKeysRequest body, ClaimsPrincipal currentUser,
        AppDbContext db, IMultipartObjectStore store, IFileStorage storage, GuestLimits limits, CancellationToken ct)
    {
        if (!store.IsConfigured)
            return ErrorEnvelope.Build(501, "presigned_unavailable",
                "Presigned upload storage is not configured; use the legacy upload endpoint.");
        if (body?.Stems is null || body.Stems.Count == 0)
            return Results.BadRequest(new { error = "At least one stem key required." });

        var userId = currentUser.UserId();
        var version = await OwnedVersion(db, versionId, userId, ct);
        if (version is null) return Results.NotFound();

        var jobId = UploadEndpoints.JobIdFromSourceKey(version.FilePath);
        if (jobId is null)
            return ErrorEnvelope.Build(501, "presigned_unavailable",
                "This version predates the presigned key layout; use the legacy upload endpoint.");
        var expectedPrefix = $"stems/{jobId}/";

        var entries = ReadRaw(version.StemPathsRaw);

        // Task G1 — same guest stems cap as StageStems. The presigned objects
        // already exist in object storage, so their actual size is available
        // up front (unlike AttachmentInit, which only has a client-declared
        // size before the PUT happens).
        if (currentUser.IsGuest())
        {
            var existingBytes = await SumStemBytesAsync(entries, storage, store, ct);
            long addBytes = 0;
            foreach (var item in body.Stems)
                addBytes += await store.GetObjectSizeAsync(item.Key, ct) ?? 0;
            if (await limits.CheckStemsAsync(entries.Count, existingBytes, body.Stems.Count, addBytes, ct) is { } denied)
                return denied;
        }

        if (entries.Count + body.Stems.Count > MaxStems)
            return Results.BadRequest(new { error = $"Up to {MaxStems} stems per version." });

        foreach (var item in body.Stems)
        {
            // Single-segment tail — StartsWith alone would let `..` segments
            // through and the worker's local resolve would escape the root.
            if (!UploadEndpoints.ValidSingleSegmentKey(item.Key, expectedPrefix))
                return Results.BadRequest(new { error = $"Key does not match this version's upload." });
            var ext = Path.GetExtension(item.Key).ToLowerInvariant();
            if (!StemAudioExts.Contains(ext))
                return Results.BadRequest(new { error = $"'{item.FileName}': only .wav / .flac stems are supported." });
            // Idempotent re-register (client retry after a lost response).
            if (entries.Any(e => e.Key == item.Key))
                continue;
            var size = await store.GetObjectSizeAsync(item.Key, ct);
            if (size is null)
                return ErrorEnvelope.Build(502, "upload_not_found",
                    $"Object for '{item.FileName}' not found in storage.");
            // Presigned PUT can't bind Content-Length — enforce the cap on the
            // ACTUAL object, not the client-declared size at init.
            if (size > MaxUploadBytes)
                return Results.BadRequest(new { error = $"'{item.FileName}' exceeds the 250 MB limit." });
            var stemId = item.StemId;
            if (string.IsNullOrWhiteSpace(stemId) || stemId.Length > 64
                || !stemId.All(c => char.IsAsciiLetterOrDigit(c) || c is '-'))
                stemId = Guid.NewGuid().ToString();
            if (entries.Any(e => e.Id == stemId))
                stemId = Guid.NewGuid().ToString();
            entries.Add(new StemRawEntry
            {
                Id = stemId,
                OriginalFilename = item.FileName,
                Key = item.Key,
            });
        }

        version.StemPathsRaw = JsonSerializer.Serialize(entries);
        version.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return Results.Ok(new StageStemsResponse(versionId, entries.Select(ToDto).ToList()));
    }

    // POST /api/versions/{id}/als-key — register a presigned-uploaded .als.
    // Mirrors UploadAls minus the byte proxy; analyze semantics identical.
    private static async Task<IResult> RegisterAlsKey(
        Guid versionId, RegisterAlsKeyRequest body, ClaimsPrincipal currentUser,
        AppDbContext db, IMultipartObjectStore store, IJobQueue queue,
        EntitlementService ents, CreditLedgerService credits, HttpContext httpCtx, CancellationToken ct)
    {
        if (!store.IsConfigured)
            return ErrorEnvelope.Build(501, "presigned_unavailable",
                "Presigned upload storage is not configured; use the legacy upload endpoint.");

        var userId = currentUser.UserId();
        var version = await OwnedVersion(db, versionId, userId, ct);
        if (version is null) return Results.NotFound();

        var jobId = UploadEndpoints.JobIdFromSourceKey(version.FilePath);
        if (jobId is null)
            return ErrorEnvelope.Build(501, "presigned_unavailable",
                "This version predates the presigned key layout; use the legacy upload endpoint.");
        if (!UploadEndpoints.ValidSingleSegmentKey(body.Key, $"als/{jobId}/"))
            return Results.BadRequest(new { error = "Key does not match this version's upload." });
        var ext = Path.GetExtension(body.Key).ToLowerInvariant();
        if (ext != ".als" && ext != ".gz")
            return Results.BadRequest(new { error = ".als (or gzip-compressed) file required." });
        var alsSize = await store.GetObjectSizeAsync(body.Key, ct);
        if (alsSize is null)
            return ErrorEnvelope.Build(502, "upload_not_found", "Object not found in storage.");
        if (alsSize > 50L * 1024 * 1024)
            return Results.BadRequest(new { error = "File exceeds 50 MB limit." });

        // Same size-bounded JSON-object validation as the multipart UploadAls.
        string? normalizedProjectJson = null;
        if (!string.IsNullOrWhiteSpace(body.ProjectJson))
        {
            if (System.Text.Encoding.UTF8.GetByteCount(body.ProjectJson) > MaxProjectJsonBytes)
                return Results.BadRequest(new { error = "Project metadata is too large." });
            try
            {
                using var probe = JsonDocument.Parse(body.ProjectJson);
                if (probe.RootElement.ValueKind != JsonValueKind.Object)
                    return Results.BadRequest(new { error = "project_json must be a JSON object." });
            }
            catch (JsonException)
            {
                return Results.BadRequest(new { error = "project_json is not valid JSON." });
            }
            normalizedProjectJson = body.ProjectJson;
        }

        version.AlsFilePath = body.Key;
        if (normalizedProjectJson is not null) version.AlsProjectJson = normalizedProjectJson;
        version.UpdatedAt = DateTimeOffset.UtcNow;
        var shouldAnalyze = body.Analyze ?? true;
        await db.SaveChangesAsync(ct);

        if (shouldAnalyze)
        {
            var (dispatchedJobId, err) = await DispatchAnalysisAsync(userId, versionId, null, db, ents, credits, queue, httpCtx, ct);
            if (err is not null) return err;
            return Results.Ok(new AlsUploadResponse(versionId, body.Key, dispatchedJobId));
        }
        return Results.Ok(new AlsUploadResponse(versionId, body.Key, null));
    }

    // POST /api/versions/{id}/stems/classify — enqueue audio-content classification.
    private static async Task<IResult> ClassifyStems(
        Guid versionId, ClaimsPrincipal currentUser, AppDbContext db, IJobQueue queue,
        GuestLimits limits, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        if (!await UserOwnsVersion(db, versionId, userId, ct)) return Results.NotFound();
        // Fix round 1 item 2 — this enqueued unconditionally with no per-guest
        // cap and hardcoded the paid lane (the only newly-opened guest enqueue
        // not using GuestLimits.QueueFor).
        if (currentUser.IsGuest())
        {
            if (await limits.CheckClassifyAsync(userId, ct) is { } denied)
                return denied;
        }
        // Story 2.5: paid-feature work → analysis-paid (W1). Free tier has stems=false.
        // Guest work rides the free lane regardless (GuestLimits.QueueFor).
        await queue.EnqueueAsync(
            DramatiqTasks.ClassifyStems, new object[] { versionId.ToString() },
            GuestLimits.QueueFor(currentUser, DramatiqQueues.AnalysisPaid), ct);
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
        AppDbContext db, IJobQueue queue, EntitlementService ents, CreditLedgerService credits,
        HttpContext httpCtx, CancellationToken ct)
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

        var (jobId, err) = await DispatchAnalysisAsync(userId, versionId, body.ReferenceId, db, ents, credits, queue, httpCtx, ct);
        if (err is not null) return err;
        return Results.Ok(new ConfirmStemsResponse(versionId, jobId));
    }

    // GET /api/versions/{id}/stems/{stemId}/audio — Range-enabled preview (JWT via ?t= works:
    // the path contains "/audio", which the JwtBearer OnMessageReceived hook whitelists).
    private static async Task<IResult> StreamStemAudio(
        Guid versionId, string stemId, ClaimsPrincipal currentUser,
        AppDbContext db, IFileStorage storage, IMultipartObjectStore objectStore,
        HttpResponse response, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var version = await OwnedVersion(db, versionId, userId, ct);
        if (version is null) return Results.NotFound();
        var entry = ReadRaw(version.StemPathsRaw).FirstOrDefault(e => e.Id == stemId);
        if (entry is null) return Results.NotFound();
        // Story 3.3: local-first proxy, else 302 to a short-lived presigned GET.
        return await MediaDelivery.ServeAsync(
            storage, objectStore, entry.Key, MediaDelivery.AudioContentType(entry.Key), response, ct);
    }

    // ── Story 3.1: shared song/version row creation ─────────────────────────
    // Extracted from UploadVersion so the presigned /uploads/complete path
    // (UploadEndpoints) creates rows identically to the legacy proxy path.
    internal static async Task<(Guid SongId, IResult? Error)> ResolveOrCreateSongAsync(
        AppDbContext db, Guid userId, string? songId, string? genreHint, string fileName, CancellationToken ct)
    {
        Guid songGuid;
        if (!string.IsNullOrEmpty(songId))
        {
            if (!Guid.TryParse(songId, out songGuid))
                return (Guid.Empty, Results.BadRequest(new { error = "Invalid song_id." }));
            var owned = await db.Songs.AnyAsync(s => s.Id == songGuid && s.UserId == userId, ct);
            if (!owned) return (Guid.Empty, Results.NotFound());
        }
        else
        {
            songGuid = Guid.NewGuid();
            var stem = Path.GetFileNameWithoutExtension(fileName);
            if (string.IsNullOrWhiteSpace(stem)) stem = "Untitled";
            if (stem.Length > 200) stem = stem[..200];

            // Wave-2 (E3.2) — the derived name is NEVER user-chosen (no song_id
            // means the dialog sent no typed name), so auto-suffix instead of
            // letting uq_songs_user_name 500 the upload: "mix", "mix (2)", ….
            // NO DeletedAt filter: the unique index is UNFILTERED, so a
            // soft-deleted song still holds its name (AppDbContext uq_songs_user_name).
            var taken = await db.Songs
                .Where(s => s.UserId == userId && s.Name.StartsWith(stem))
                .Select(s => s.Name)
                .ToListAsync(ct);
            var name = stem;
            for (var n = 2; taken.Contains(name); n++)
            {
                var suffix = $" ({n})";
                var maxBase = 200 - suffix.Length; // keep the suffixed name within the 200-char column cap
                name = (stem.Length > maxBase ? stem[..maxBase] : stem) + suffix;
            }

            db.Songs.Add(new Song
            {
                Id = songGuid,
                UserId = userId,
                Name = name,
                GenreHint = string.IsNullOrWhiteSpace(genreHint) ? null : genreHint!.Trim(),
            });
        }
        return (songGuid, null);
    }

    // Allocates the next version number, demotes the previous current version,
    // and stages the new SongVersion row (caller SaveChanges).
    internal static async Task<Guid> InsertVersionRowAsync(
        AppDbContext db, Guid songGuid, string fileKey, CancellationToken ct)
    {
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
            FilePath = fileKey,
            IsCurrent = true,
        });
        return versionId;
    }

    // ── Story 2.4: Entitlement-gated dispatch ───────────────────────────────
    // Single authoritative dispatch path. All analyze-dispatch sites route
    // through here (incl. story 3.1's /uploads/complete in UploadEndpoints).
    // Never called by result-read handlers (AR15).
    //
    // preallocatedJobId: pass when the caller already used the jobId in a
    // storage key (e.g. UploadVersion: "audio/upload/{jobId}/...").
    // 10.6 review: IPv6 → /64 prefix (one rotation per request would
    // otherwise walk past any per-IP arm); IPv4 verbatim; null → null.
    internal static string? NormalizeIpForLimiting(System.Net.IPAddress? addr)
    {
        if (addr is null) return null;
        if (addr.AddressFamily != System.Net.Sockets.AddressFamily.InterNetworkV6)
            return addr.ToString();
        if (addr.IsIPv4MappedToIPv6) return addr.MapToIPv4().ToString();
        var bytes = addr.GetAddressBytes();
        for (var i = 8; i < 16; i++) bytes[i] = 0;
        return new System.Net.IPAddress(bytes) + "/64";
    }

    internal static async Task<(Guid JobId, IResult? Error)> DispatchAnalysisAsync(
        Guid userId,
        Guid versionId,
        Guid? referenceId,
        AppDbContext db,
        EntitlementService ents,
        CreditLedgerService credits,
        IJobQueue queue,
        HttpContext httpCtx,
        CancellationToken ct,
        Guid? preallocatedJobId = null,
        bool freeRetry = false,
        Guid? retryOfJobId = null)
    {
        // Task D6 (spec D5) — the guest's own quota + the global fail-closed
        // arm, checked FIRST so nothing below (entitlement resolution, job
        // insert) runs for a guest who's already spent their one analysis.
        // Fix round 1 item 1 — unlike a real user's free retry (exempt, see
        // below), a GUEST never takes the freeRetry exemption here: a
        // degraded job is easy to provoke, and every degraded job was
        // retry-eligible, so an exempt guest retry doubled the effective
        // per-guest analysis budget for free. The retry is checked and
        // counted exactly like any other guest analysis.
        var isGuest = httpCtx.User.IsGuest();
        if (isGuest)
        {
            var g = await httpCtx.RequestServices.GetRequiredService<GuestLimits>()
                .CheckAnalysisAsync(userId, versionId, httpCtx, ct);
            if (g is not null) return (Guid.Empty, g);
        }

        // Story 5.7 (FR6/AR16): freeRetry dispatches WITHOUT consuming
        // entitlement — the exhausted-cap gate is skipped and NOTHING is
        // written to usage_events / credit_ledger (never-consumed beats
        // write-then-compensate; balances are never UPDATEd either way).
        // Eligibility is decided by the caller (JobEndpoints.RetryFree)
        // entirely server-side. Abuse layers below still apply.
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

        var prices = await ents.GetPricesAsync(ct);

        if (!freeRetry && ent.AnalysesRemaining == 0)
        {
            // Credit economy: a credits/pro user who can't cover the price gets
            // the buy sheet (402); a free-tier user keeps the legacy 409 grammar.
            return (Guid.Empty, ent.Tier is "credits" or "pro"
                ? ErrorEnvelope.Build(402, "insufficient_credits", "Not enough credits for an analysis.",
                    new { required = prices.Analysis, balance = ent.CreditBalance })
                : ErrorEnvelope.Build(409, "entitlement_exhausted",
                    "You have used all your analyses for this billing period."));
        }

        // Story 10.6 (FR47) — the CROSS-ACCOUNT layers. Per-account caps are
        // useless against N disposable accounts; these arms see through them.
        // Paying users (Pro or a purchase) exempt — a signup-grant-only account
        // is not paying (grant farming). Both checks fail-open.
        if (!ent.IsPaying)
        {
            var cfg106 = httpCtx.RequestServices.GetRequiredService<IConfiguration>();
            var limitsOn = !string.Equals(cfg106["RateLimits:Enabled"], "false", StringComparison.OrdinalIgnoreCase);

            // (a) Disposable-domain accounts get a REDUCED cap (default 1) —
            // the throttle answer to "50 analyses through disposable emails".
            // Story 12.1 (AC4): this arm is throttling ("throttling layer
            // only"), so it sits behind the same RateLimits:Enabled knob as
            // the per-IP arm — dev/test registrations with throwaway domains
            // must not get a mislabeled entitlement_exhausted.
            // Story 5.7: the disposable arm is an entitlement-style CAP (counts
            // usage events), not a rate limit — a free retry consumes nothing,
            // so it must not be blocked by an already-spent cap either. The
            // per-IP limiter below still applies to free retries.
            if (limitsOn && !freeRetry)
            {
                try
                {
                    var disposables = httpCtx.RequestServices.GetRequiredService<DisposableEmailService>();
                    var emailAddr = await db.Users.AsNoTracking()
                        .Where(u => u.Id == userId).Select(u => u.Email).FirstOrDefaultAsync(ct);
                    if (emailAddr is not null && await disposables.IsDisposableAsync(emailAddr, ct))
                    {
                        var flags = await ents.GetFlagsAsync(ct);
                        var dispCap = flags.TryGetValue("disposable_free_analyses", out var dv)
                            && int.TryParse(dv, out var dn) && dn > 0 ? dn : 1;
                        var period = DateTimeOffset.UtcNow.ToString("yyyy-MM");
                        // SAME exclusion as EntitlementService (AR16): an
                        // invalid_file failure must not consume the disposable
                        // cap either — a false positive still gets their one
                        // analysis even after a broken upload.
                        var used = await db.UsageEvents.AsNoTracking()
                            .CountAsync(e => e.UserId == userId
                                && e.EventType == "analysis" && e.BillingPeriod == period
                                && !db.AnalysisJobs.Any(j =>
                                    j.ErrorCode == "invalid_file" && j.Id.ToString() == e.Reference), ct);
                        if (used >= dispCap)
                            return (Guid.Empty, ErrorEnvelope.Build(409, "entitlement_exhausted",
                                "You have used all your analyses for this billing period."));
                    }
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception) { /* fail-open — throttling layer only */ }
            }

            // (b) Per-IP dispatch ceiling: N accounts on one machine share one
            // budget (default 10/h — generous for humans/NAT, fatal for scripts).
            if (limitsOn)
            {
                try
                {
                    // IPv6 buckets to /64 (a residential /64 is one "machine"
                    // for abuse purposes — per-address keying would hand the
                    // abuser 2^64 fresh identities). Null IP = fail-open,
                    // never a shared "unknown" bucket (fail-closed trap).
                    var ip = NormalizeIpForLimiting(httpCtx.Connection.RemoteIpAddress);
                    if (ip is not null)
                    {
                        var limiter = httpCtx.RequestServices.GetRequiredService<IRateLimiter>();
                        var flags = await ents.GetFlagsAsync(ct);
                        var perIp = flags.TryGetValue("dispatch_per_ip_hourly", out var pv)
                            && int.TryParse(pv, out var pn) && pn > 0 ? pn : 10;
                        var verdict = await limiter.CheckAsync(
                            $"user:{userId}", ip, "analysis_dispatch", perIp, TimeSpan.FromHours(1), ct);
                        if (!verdict.Allowed)
                            return (Guid.Empty, ErrorEnvelope.Build(429, "rate_limited",
                                "Too many analyses — slow down or upgrade."));
                    }
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception) { /* fail-open (Redis blip) */ }
            }
        }

        // Story 4.5 (AC5/AR26) — the SECOND-analysis verify gate: a free-tier
        // user with an unverified email gets exactly one analysis; the next
        // dispatch requires verification. Paying users (Pro or a purchase)
        // exempt (Stripe receipts already prove a mailbox; a signup-grant-only
        // account is NOT paying). Report VIEWING is never gated — read
        // paths don't check this.
        // Story 5.7 review: the verify gate exists to stop a SECOND analysis
        // grant — a free retry re-runs an ALREADY-granted one, and its origin
        // (a degraded complete job) would otherwise count as the "one
        // analysis" and 403 the flagship unverified-free-user scenario.
        if (!freeRetry && !ent.IsPaying)
        {
            var verified = await db.Users.AsNoTracking()
                .Where(u => u.Id == userId)
                .Select(u => u.EmailVerifiedAt)
                .FirstOrDefaultAsync(ct);
            // Failed jobs don't count — a user whose one free analysis died
            // on an infrastructure error must be able to retry unverified.
            if (verified is null
                && await db.AnalysisJobs.AsNoTracking()
                    .AnyAsync(j => j.UserId == userId && j.Status != "failed", ct))
                return (Guid.Empty, ErrorEnvelope.Build(403, "email_verification_required",
                    "Verify your email to run another analysis. Check your inbox for the link."));
        }

        var jobId = preallocatedJobId ?? Guid.NewGuid();
        var billingPeriod = DateTimeOffset.UtcNow.ToString("yyyy-MM");

        if (freeRetry)
        {
            // Story 5.7 — entitlement-free lane: job row only, NO usage event,
            // NO credit spend, for a REAL user. A null origin would skip every
            // once-only guard (an unmarked free job, itself retry-eligible) —
            // hard-reject.
            if (retryOfJobId is not Guid)
                throw new ArgumentException(
                    "freeRetry dispatch requires retryOfJobId", nameof(retryOfJobId));
            db.AnalysisJobs.Add(new AnalysisJob
            {
                Id = jobId,
                UserId = userId,
                VersionId = versionId,
                ReferenceId = referenceId,
                Tier = ent.Tier,
                Status = "pending",
                RetryOfJobId = retryOfJobId,
            });
            if (isGuest)
            {
                // Fix round 1 item 1 — a guest's retry is NOT entitlement-free:
                // it must write the same usage_event a normal guest analysis
                // does, or CheckAnalysisAsync's per-guest count above never
                // moves and the cap it just passed is meaningless.
                db.UsageEvents.Add(new UsageEvent
                {
                    UserId = userId,
                    EventType = "analysis",
                    BillingPeriod = billingPeriod,
                    Reference = jobId.ToString(),
                });
            }
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException)
            {
                // Partial unique index on retry_of_job_id: the concurrent
                // double-POST loser lands here — the DB, not a read-then-
                // insert check, is the once-only authority.
                return (Guid.Empty, ErrorEnvelope.Build(409, "retry_already_used",
                    "The free retry for this analysis was already used."));
            }
        }
        else if ((ent.Tier == "pro" && ent.ProAnalysesUsed < (ent.ProAnalysesLimit ?? int.MaxValue))
                 || ent.Tier == "free")
        {
            // Pro within its monthly allowance, or legacy free allotment:
            // job + usage event, no credits (single SaveChanges = implicit TX).
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
        else
        {
            // Credits tier, or Pro past its allowance: charge the analysis price.
            // Insert job first (outside Serializable TX), then charge atomically.
            var job = new AnalysisJob
            {
                Id = jobId,
                UserId = userId,
                VersionId = versionId,
                ReferenceId = referenceId,
                Tier = ent.Tier,
                Status = "pending",
            };
            db.AnalysisJobs.Add(job);
            await db.SaveChangesAsync(ct);

            try
            {
                await credits.ChargeAsync(userId, prices.Analysis, jobId.ToString(),
                    $"spend:analysis:{jobId}", "analysis", ct, billingPeriod);
            }
            catch (InsufficientCreditsException ex)
            {
                // Race: balance dropped between entitlement check and charge.
                job.Status = "failed";
                job.ErrorCode = "insufficient_credits";
                job.FailedAt = DateTimeOffset.UtcNow;
                await db.SaveChangesAsync(ct);
                return (Guid.Empty, ErrorEnvelope.Build(402, "insufficient_credits",
                    "Not enough credits for an analysis.",
                    new { required = ex.Required, balance = ex.CurrentBalance }));
            }
            // Refresh the balance chip on the next entitlements read.
            ents.InvalidateAsync(userId);
        }

        // Enqueue AFTER transaction commits (AR13: worker reads tier from job row).
        // Story 2.5: tier-route so paid/credit jobs never starve behind the free flood.
        // Route off ent.Tier (the resolver's authoritative value, already in hand) — not a
        // re-read of job.Tier. analyze_audio_job is consumed from BOTH lanes (W1 + W2); the
        // queue here is the real router (Dramatiq dispatches by actor_name on arrival).
        // Task D6 (spec D5) — guest analyses ALWAYS route to analysis-free,
        // whatever ent.Tier resolved to (a guest reads as "pro" when the
        // credits kill switch is off — this override stops that from
        // starving the paid lane).
        var queueName = isGuest ? DramatiqQueues.AnalysisFree : ent.Tier switch
        {
            "pro"     => DramatiqQueues.AnalysisPaid,
            "credits" => DramatiqQueues.AnalysisPaid,
            _         => DramatiqQueues.AnalysisFree, // "free", null, future anonymous
        };
        try
        {
            await queue.EnqueueAsync(
                DramatiqTasks.AnalyzeAudioJob,
                new object[] { jobId.ToString() },
                queueName,
                ct);
        }
        catch (Exception)
        {
            // Story 3.5 review: an enqueue failure (Redis down) after the job
            // row committed would leave a MESSAGELESS pending row — with the
            // NFR16 pending grace it would now sit 4 h before resurfacing, and
            // a credits spend would never be reversed. Fail it immediately as
            // dispatch_failed (≠ invalid_file, so no automatic refund path —
            // the user re-runs; ≠ worker_unavailable, so logs distinguish
            // enqueue failure from worker death).
            var row = await db.AnalysisJobs.FirstOrDefaultAsync(j => j.Id == jobId, ct);
            if (row is not null)
            {
                if (freeRetry)
                {
                    // Story 5.7 review: a failed free-retry row would occupy the
                    // once-only unique slot FOREVER (every later attempt → 409
                    // retry_already_used) over a Redis blip. Nothing was
                    // consumed and nothing references the row — delete it so
                    // the user can retry the retry.
                    db.AnalysisJobs.Remove(row);
                }
                else
                {
                    row.Status = "failed";
                    row.ErrorCode = "dispatch_failed";
                    row.ErrorMessage = "Could not queue the analysis. Try again.";
                    row.CurrentPhase = "failed";
                    row.FailedAt = DateTimeOffset.UtcNow;
                }
                await db.SaveChangesAsync(ct);
                if (!freeRetry)
                {
                    // Credit economy (spec 3.4): the client never receives the jobId
                    // (this rethrows → 500), so the lazy GET /jobs/{id} refund would
                    // never fire. Refund here, same key as that path ("reversal:{jobId}")
                    // so the two can never both pay out. Pro-allowance jobs spent
                    // nothing → no-op.
                    try { await credits.ReverseAsync(userId, jobId, "dispatch_failed", CancellationToken.None); }
                    catch (Exception) { /* the lazy read-path refund is the backstop */ }
                }
            }
            throw;
        }
        return (jobId, null);
    }

    // ── PUT /api/versions/{id}/rating — upsert personal score (0..100) ────────
    public sealed record SetRatingRequest(int Score);

    private static async Task<IResult> SetRating(
        Guid versionId, SetRatingRequest body, ClaimsPrincipal currentUser, AppDbContext db, CancellationToken ct)
    {
        if (body.Score is < 0 or > 100)
            return Results.BadRequest(new { error = "score must be 0..100" });
        var userId = currentUser.UserId();

        if (!await UserOwnsVersion(db, versionId, userId, ct)) return Results.NotFound();

        var row = await db.VersionUserRatings
            .FirstOrDefaultAsync(r => r.UserId == userId && r.VersionId == versionId, ct);
        if (row is null)
        {
            db.VersionUserRatings.Add(new VersionUserRating { UserId = userId, VersionId = versionId, Score = body.Score });
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException)
            {
                // Concurrent insert won the race; detach the failed entity, re-resolve and update.
                db.ChangeTracker.Clear();
                row = await db.VersionUserRatings
                    .FirstOrDefaultAsync(r => r.UserId == userId && r.VersionId == versionId, ct);
                if (row is not null)
                {
                    row.Score = body.Score;
                    row.UpdatedAt = DateTimeOffset.UtcNow;
                    await db.SaveChangesAsync(ct);
                }
            }
        }
        else
        {
            row.Score = body.Score;
            row.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);
        }
        return Results.Ok(new { score = body.Score });
    }

    // ── DELETE /api/versions/{id}/rating — remove personal score ─────────────
    private static async Task<IResult> ClearRating(
        Guid versionId, ClaimsPrincipal currentUser, AppDbContext db, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var row = await db.VersionUserRatings
            .FirstOrDefaultAsync(r => r.UserId == userId && r.VersionId == versionId, ct);
        if (row is not null) { db.VersionUserRatings.Remove(row); await db.SaveChangesAsync(ct); }
        return Results.NoContent();
    }
}
