using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Security.Claims;
using System.Text.Json;

namespace Spectr.Bff.Endpoints;

public static class ReferenceEndpoints
{
    private const long MaxUploadBytes = 250L * 1024 * 1024;

    public static IEndpointRouteBuilder MapReferenceEndpoints(this IEndpointRouteBuilder app)
    {
        var refs = app.MapGroup("/references").WithTags("references").RequireAuthorization();
        refs.MapGet("/", List);
        // Task G1 — a guest may upload ONE reference track (CheckReferenceAsync).
        refs.MapPost("/", Upload)
            .DisableAntiforgery()
            .WithMetadata(new RequestSizeLimitAttribute(MaxUploadBytes))
            .AllowGuest();
        refs.MapPost("/batch", UploadBatch)
            .DisableAntiforgery()
            .WithMetadata(new RequestSizeLimitAttribute(MaxUploadBytes * 100));
        // Story 3.2 — register a reference already PUT via the presigned path.
        refs.MapPost("/complete-key", CompleteKey).AllowGuest();
        refs.MapPost("/analyze", AnalyzeBatch);
        refs.MapGet("/{referenceId:guid}", GetById);
        refs.MapPatch("/{referenceId:guid}", Patch);
        refs.MapDelete("/{referenceId:guid}", Delete).AllowGuest();
        refs.MapPost("/{referenceId:guid}/analyze", Analyze).AllowGuest();

        var sets = app.MapGroup("/reference-sets").WithTags("reference-sets").RequireAuthorization();
        sets.MapGet("/", ListSets);
        sets.MapGet("/{setId:guid}", GetSetDetail);
        sets.MapPost("/", CreateSet);
        sets.MapPatch("/{setId:guid}", PatchSet);
        sets.MapDelete("/{setId:guid}", DeleteSet);
        sets.MapPost("/{setId:guid}/members", AddMember);
        sets.MapDelete("/{setId:guid}/members/{referenceId:guid}", RemoveMember);

        return app;
    }

    // ── /references ─────────────────────────────────────────────────────────
    private static async Task<IResult> List(
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var rows = await db.ReferenceTracks.AsNoTracking()
            .Where(r => r.UserId == userId)
            .OrderByDescending(r => r.CreatedAt)
            .ToListAsync(ct);

        // One batched membership lookup, grouped into a per-reference setId list,
        // so the grid can filter by set without N round-trips.
        var refIds = rows.Select(r => r.Id).ToHashSet();
        var membership = (await db.ReferenceSetMembers.AsNoTracking()
                .Where(m => refIds.Contains(m.ReferenceId))
                .Select(m => new { m.ReferenceId, m.SetId })
                .ToListAsync(ct))
            .GroupBy(m => m.ReferenceId)
            .ToDictionary(g => g.Key, g => (IReadOnlyList<Guid>)g.Select(x => x.SetId).ToList());

        return Results.Ok(rows.Select(r =>
            ToDto(r, membership.TryGetValue(r.Id, out var sids) ? sids : null)).ToList());
    }

    // Fix round 1 item 4(a) — Content-Length proxy slack for multipart
    // boundaries/headers, same value as VersionEndpoints.StageStems.
    private const long MultipartSlackBytes = 1L * 1024 * 1024;

    private static async Task<IResult> Upload(
        HttpRequest request,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IFileStorage storage,
        GuestLimits limits,
        CancellationToken ct)
    {
        if (!request.HasFormContentType)
            return Results.BadRequest(new { error = "multipart/form-data required." });
        var userId = currentUser.UserId();

        // Fix round 1 item 4(a) — reject an over-budget guest body from its
        // Content-Length BEFORE the form is read: the [FromForm] auto-bound
        // IFormFile this used to be buffers the whole file during parameter
        // binding, before ANY handler code runs — moving the check inside the
        // handler body alone can't prevent that read, so this endpoint reads
        // the request manually instead (same pattern as StageStems).
        // References are capped by COUNT, not bytes (CheckReferenceAsync
        // below), so the budget here is simply the existing single-file
        // ceiling + multipart slack.
        if (currentUser.IsGuest())
        {
            var len = request.ContentLength;
            if (len is null || len > MaxUploadBytes + MultipartSlackBytes)
                return GuestGuard.Restricted("reference_limit",
                    "A guest session includes a limited upload size — create a free account for more.");

            // Task G7a (R1) — needs only the userId, so it runs BEFORE
            // ReadFormAsync below. Previously this ran after the form was
            // already read/buffered, so an at-cap guest could push up to
            // 250 MB into temp storage per rejected request, repeatedly.
            if (await limits.CheckReferenceAsync(userId, ct) is { } denied)
                return denied;
        }

        var form = await request.ReadFormAsync(ct);
        var file = form.Files.GetFile("file");
        var title = form.TryGetValue("title", out var titleVals) ? titleVals.ToString() : null;
        var artist = form.TryGetValue("artist", out var artistVals) ? artistVals.ToString() : null;
        var genre = form.TryGetValue("genre", out var genreVals) ? genreVals.ToString() : null;

        if (file is null || file.Length == 0)
            return Results.BadRequest(new { error = "Empty file." });
        if (file.Length > MaxUploadBytes)
            return Results.BadRequest(new { error = "File exceeds 250 MB limit." });

        var titleClean = (title ?? Path.GetFileNameWithoutExtension(file.FileName) ?? "Untitled").Trim();
        if (string.IsNullOrEmpty(titleClean)) titleClean = "Untitled";
        if (titleClean.Length > 200) titleClean = titleClean[..200];

        var refId = Guid.NewGuid();
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (string.IsNullOrEmpty(ext)) ext = ".bin";
        var key = $"audio/reference/{refId}/source{ext}";

        await using (var src = file.OpenReadStream())
        {
            await storage.WriteAsync(
                key,
                src,
                file.ContentType ?? "application/octet-stream",
                ct);
        }

        var row = new ReferenceTrack
        {
            Id = refId,
            UserId = userId,
            Title = titleClean,
            Artist = string.IsNullOrWhiteSpace(artist) ? null : artist!.Trim(),
            Genre = string.IsNullOrWhiteSpace(genre) ? null : genre!.Trim(),
            Source = "file",
            FilePath = key,
        };
        db.ReferenceTracks.Add(row);
        await db.SaveChangesAsync(ct);
        return Results.Created($"/api/references/{refId}", ToDto(row));
    }

    public sealed record CompleteKeyRequest(
        Guid ReferenceId, string Key, string FileName, string? Title, string? Artist, string? Genre);

    // Story 3.2 — POST /api/references/complete-key. The client PUT the bytes
    // straight to object storage (key minted by /uploads/attachments/init as
    // reference/{refId}/source.*); this registers the row. Prefix + existence
    // are re-verified so a forged key can't reference someone else's object.
    private static async Task<IResult> CompleteKey(
        CompleteKeyRequest body,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IMultipartObjectStore store,
        GuestLimits limits,
        CancellationToken ct)
    {
        if (!store.IsConfigured)
            return ErrorEnvelope.Build(501, "presigned_unavailable",
                "Presigned upload storage is not configured; use the legacy upload endpoint.");

        var userId = currentUser.UserId();

        // Task G1 — one reference track per guest (same cap as Upload).
        if (currentUser.IsGuest() && await limits.CheckReferenceAsync(userId, ct) is { } denied)
            return denied;

        var expectedPrefix = $"reference/{body.ReferenceId}/";
        if (!UploadEndpoints.ValidSingleSegmentKey(body.Key, expectedPrefix))
            return Results.BadRequest(new { error = "Key does not match this reference upload." });
        if (await db.ReferenceTracks.AsNoTracking().AnyAsync(r => r.Id == body.ReferenceId, ct))
            return Results.Conflict(new { error = "Reference already registered." });
        var size = await store.GetObjectSizeAsync(body.Key, ct);
        if (size is null)
            return ErrorEnvelope.Build(502, "upload_not_found", "Object not found in storage.");
        if (size > MaxUploadBytes)
            return Results.BadRequest(new { error = "File exceeds 250 MB limit." });

        var titleClean = (body.Title ?? Path.GetFileNameWithoutExtension(body.FileName) ?? "Untitled").Trim();
        if (string.IsNullOrEmpty(titleClean)) titleClean = "Untitled";
        if (titleClean.Length > 200) titleClean = titleClean[..200];

        var row = new ReferenceTrack
        {
            Id = body.ReferenceId,
            UserId = userId,
            Title = titleClean,
            Artist = string.IsNullOrWhiteSpace(body.Artist) ? null : body.Artist!.Trim(),
            Genre = string.IsNullOrWhiteSpace(body.Genre) ? null : body.Genre!.Trim(),
            Source = "file",
            FilePath = body.Key,
        };
        db.ReferenceTracks.Add(row);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Concurrent double-complete: the PK absorbed the race — answer
            // the same 409 the AnyAsync pre-check gives, not a 500.
            return Results.Conflict(new { error = "Reference already registered." });
        }
        return Results.Created($"/api/references/{row.Id}", ToDto(row));
    }

    private static async Task<IResult> GetById(
        Guid referenceId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var row = await db.ReferenceTracks.AsNoTracking()
            .FirstOrDefaultAsync(r => r.Id == referenceId && r.UserId == userId, ct);
        if (row is null) return Results.NotFound();
        return Results.Ok(ToDto(row, await SetIdsForAsync(db, row.Id, ct)));
    }

    private static async Task<IResult> Patch(
        Guid referenceId,
        PatchReferenceRequest body,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var row = await db.ReferenceTracks
            .FirstOrDefaultAsync(r => r.Id == referenceId && r.UserId == userId, ct);
        if (row is null) return Results.NotFound();

        if (body.Title is not null)
        {
            var t = body.Title.Trim();
            if (t.Length == 0) return Results.BadRequest(new { error = "Title cannot be empty." });
            if (t.Length > 200) t = t[..200];
            row.Title = t;
        }
        if (body.Artist is not null)
            row.Artist = string.IsNullOrWhiteSpace(body.Artist) ? null : body.Artist.Trim();
        if (body.Genre is not null)
            row.Genre = string.IsNullOrWhiteSpace(body.Genre) ? null : body.Genre.Trim();
        if (body.Notes is not null)
            row.Notes = string.IsNullOrWhiteSpace(body.Notes) ? null : body.Notes;
        if (body.Tags is not null)
            row.Tags = body.Tags.Value.GetRawText();

        await db.SaveChangesAsync(ct);
        return Results.Ok(ToDto(row, await SetIdsForAsync(db, row.Id, ct)));
    }

    private static async Task<IResult> Delete(
        Guid referenceId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IFileStorage storage,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var row = await db.ReferenceTracks
            .FirstOrDefaultAsync(r => r.Id == referenceId && r.UserId == userId, ct);
        if (row is null) return Results.NotFound();

        // Also clean up any reference-set memberships pointing at this row to
        // avoid orphaned set_members rows. PostgreSQL FK cascade would handle
        // this if the schema declared ON DELETE CASCADE; doing it in app
        // code keeps that decision in one place.
        await db.ReferenceSetMembers
            .Where(m => m.ReferenceId == referenceId)
            .ExecuteDeleteAsync(ct);

        var key = row.FilePath;
        db.ReferenceTracks.Remove(row);
        await db.SaveChangesAsync(ct);

        if (!string.IsNullOrEmpty(key))
        {
            // Task G1 — a reference blob is never seeded/shared (no demo
            // reference exists), but route every guest-reachable delete
            // through the shared-audio guard for consistency with the
            // version/song delete paths.
            try { await storage.DeleteUnlessSharedAsync(key, ct); }
            catch { /* orphaned file is harmless once row is gone */ }
        }
        return Results.NoContent();
    }

    private static async Task<IResult> Analyze(
        Guid referenceId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IJobQueue queue,
        GuestLimits limits,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var row = await db.ReferenceTracks.AsNoTracking()
            .FirstOrDefaultAsync(r => r.Id == referenceId && r.UserId == userId, ct);
        if (row is null) return Results.NotFound();
        if (string.IsNullOrEmpty(row.FilePath))
            return Results.BadRequest(new { error = "Reference has no file to analyze." });

        // Fix round 1 item 2 — this route already rode the free lane
        // (GuestLimits.QueueFor below) but had no cap of its own.
        if (currentUser.IsGuest())
        {
            if (await limits.CheckReferenceAnalyzeAsync(userId, ct) is { } denied)
                return denied;
        }

        // Enqueue the dedicated reference-analyzer actor; it'll populate
        // BPM/LUFS/etc. and flip `analyzed=true` on success. Task G1 —
        // guest reference-analysis work rides the free lane, same as every
        // other guest LLM/analysis dispatch (GuestLimits.QueueFor).
        await queue.EnqueueAsync(
            DramatiqTasks.RunReferenceAnalyzer,
            new object[] { referenceId.ToString() },
            GuestLimits.QueueFor(currentUser, DramatiqQueues.AnalysisPaid), // story 2.5: low-volume secondary op → W1
            ct);
        return Results.Accepted(value: ToDto(row));
    }

    // Batch upload — drop many reference tracks at once. Each lands as a `pending`
    // row; analysis is an explicit follow-up (AnalyzeBatch), never auto-enqueued.
    private static async Task<IResult> UploadBatch(
        [FromForm] IFormFileCollection files,
        [FromForm(Name = "genre")] string? genre,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IFileStorage storage,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        if (files is null || files.Count == 0)
            return Results.BadRequest(new { error = "No files." });

        var created = new List<ReferenceTrack>(files.Count);
        foreach (var file in files)
        {
            if (file.Length == 0) continue;
            if (file.Length > MaxUploadBytes)
                return Results.BadRequest(new { error = $"'{file.FileName}' exceeds 250 MB limit." });

            var titleClean = (Path.GetFileNameWithoutExtension(file.FileName) ?? "Untitled").Trim();
            if (string.IsNullOrEmpty(titleClean)) titleClean = "Untitled";
            if (titleClean.Length > 200) titleClean = titleClean[..200];

            var refId = Guid.NewGuid();
            var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (string.IsNullOrEmpty(ext)) ext = ".bin";
            var key = $"audio/reference/{refId}/source{ext}";
            await using (var src = file.OpenReadStream())
                await storage.WriteAsync(key, src, file.ContentType ?? "application/octet-stream", ct);

            var row = new ReferenceTrack
            {
                Id = refId,
                UserId = userId,
                Title = titleClean,
                Genre = string.IsNullOrWhiteSpace(genre) ? null : genre!.Trim(),
                Source = "file",
                FilePath = key,
                AnalysisStatus = "pending",
            };
            db.ReferenceTracks.Add(row);
            created.Add(row);
        }

        if (created.Count == 0)
            return Results.BadRequest(new { error = "All files were empty." });
        await db.SaveChangesAsync(ct);
        return Results.Created("/api/references", created.Select(r => ToDto(r)).ToList());
    }

    // Bulk analyze by id — enqueue the reference analyzer for each owned, not-yet-
    // analyzed reference; resets failed/stale rows to pending first.
    private static async Task<IResult> AnalyzeBatch(
        BatchAnalyzeRequest body,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IJobQueue queue,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var idSet = (body.Ids ?? Array.Empty<Guid>()).ToHashSet();
        if (idSet.Count == 0) return Results.Ok(new { enqueued = 0 });

        // Tracked load (we mutate status) — owner-scoped, skip already-analyzed.
        var rows = await db.ReferenceTracks
            .Where(r => r.UserId == userId && idSet.Contains(r.Id)
                && !r.Analyzed && r.FilePath != null)
            .ToListAsync(ct);
        foreach (var r in rows)
        {
            r.AnalysisStatus = "pending";
            r.AnalysisError = null;
        }
        await db.SaveChangesAsync(ct);

        foreach (var r in rows)
            await queue.EnqueueAsync(
                DramatiqTasks.RunReferenceAnalyzer,
                new object[] { r.Id.ToString() },
                DramatiqQueues.AnalysisPaid,
                ct);
        return Results.Accepted(value: new { enqueued = rows.Count });
    }

    // ── /reference-sets ─────────────────────────────────────────────────────
    private static async Task<IResult> ListSets(
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var sets = await db.ReferenceSets.AsNoTracking()
            .Where(s => s.UserId == userId)
            .OrderByDescending(s => s.CreatedAt)
            .ToListAsync(ct);
        var ids = sets.Select(s => s.Id).ToHashSet();
        var counts = await db.ReferenceSetMembers.AsNoTracking()
            .Where(m => ids.Contains(m.SetId))
            .GroupBy(m => m.SetId)
            .Select(g => new { SetId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.SetId, x => x.Count, ct);
        // Analyzed-member count per set (drives "X of Y analyzed" + profile readiness).
        var analyzedCounts = await db.ReferenceSetMembers.AsNoTracking()
            .Where(m => ids.Contains(m.SetId))
            .Join(db.ReferenceTracks.Where(t => t.Analyzed),
                m => m.ReferenceId, t => t.Id, (m, _) => m.SetId)
            .GroupBy(s => s)
            .Select(g => new { SetId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.SetId, x => x.Count, ct);
        var dtos = sets.Select(s => new ReferenceSetDto(
            s.Id, s.Name, s.Hue,
            counts.TryGetValue(s.Id, out var c) ? c : 0,
            analyzedCounts.TryGetValue(s.Id, out var ac) ? ac : 0,
            s.CreatedAt)).ToList();
        return Results.Ok(dtos);
    }

    // The profile detail view: the set + its lazily-refreshed aggregate + members.
    private static async Task<IResult> GetSetDetail(
        Guid setId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        ReferenceProfileAggregator aggregator,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        // Tracked (EnsureFresh may mutate the set's cached aggregate → SaveChanges).
        var set = await db.ReferenceSets
            .FirstOrDefaultAsync(s => s.Id == setId && s.UserId == userId, ct);
        if (set is null) return Results.NotFound();

        var members = await db.ReferenceSetMembers.AsNoTracking()
            .Where(m => m.SetId == setId)
            .Join(db.ReferenceTracks, m => m.ReferenceId, t => t.Id, (_, t) => t)
            .ToListAsync(ct);

        aggregator.EnsureFresh(set, members);
        await db.SaveChangesAsync(ct);

        var summaries = members
            .Select(t => new ReferenceSummaryDto(t.Id, t.Title, t.Artist, t.AnalysisStatus, t.AnalysisError))
            .ToList();
        var dto = new ReferenceSetDetailDto(
            set.Id, set.Name, set.Hue,
            members.Count,
            ReferenceProfileAggregator.AnalyzedCount(members),
            ParseJsonElement(set.ProfileJson),
            summaries,
            set.CreatedAt);
        return Results.Ok(dto);
    }

    private static async Task<IResult> CreateSet(
        CreateReferenceSetRequest body,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var name = (body.Name ?? "").Trim();
        if (string.IsNullOrEmpty(name))
            return Results.BadRequest(new { error = "Name is required." });
        if (name.Length > 120) name = name[..120];

        var row = new ReferenceSet
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Name = name,
            Hue = body.Hue,
        };
        db.ReferenceSets.Add(row);
        await db.SaveChangesAsync(ct);
        return Results.Created(
            $"/api/reference-sets/{row.Id}",
            new ReferenceSetDto(row.Id, row.Name, row.Hue, 0, 0, row.CreatedAt));
    }

    private static async Task<IResult> PatchSet(
        Guid setId,
        PatchReferenceSetRequest body,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var row = await db.ReferenceSets
            .FirstOrDefaultAsync(s => s.Id == setId && s.UserId == userId, ct);
        if (row is null) return Results.NotFound();

        if (body.Name is not null)
        {
            var n = body.Name.Trim();
            if (n.Length == 0) return Results.BadRequest(new { error = "Name cannot be empty." });
            if (n.Length > 120) n = n[..120];
            row.Name = n;
        }
        if (body.Hue is not null) row.Hue = body.Hue;

        await db.SaveChangesAsync(ct);
        var count = await db.ReferenceSetMembers.CountAsync(m => m.SetId == row.Id, ct);
        var analyzedCount = await db.ReferenceSetMembers
            .Where(m => m.SetId == row.Id)
            .Join(db.ReferenceTracks.Where(t => t.Analyzed), m => m.ReferenceId, t => t.Id, (m, _) => m)
            .CountAsync(ct);
        return Results.Ok(new ReferenceSetDto(row.Id, row.Name, row.Hue, count, analyzedCount, row.CreatedAt));
    }

    private static async Task<IResult> DeleteSet(
        Guid setId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var row = await db.ReferenceSets
            .FirstOrDefaultAsync(s => s.Id == setId && s.UserId == userId, ct);
        if (row is null) return Results.NotFound();
        await db.ReferenceSetMembers
            .Where(m => m.SetId == setId)
            .ExecuteDeleteAsync(ct);
        db.ReferenceSets.Remove(row);
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    private static async Task<IResult> AddMember(
        Guid setId,
        AddReferenceToSetRequest body,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var setOwned = await db.ReferenceSets
            .AnyAsync(s => s.Id == setId && s.UserId == userId, ct);
        if (!setOwned) return Results.NotFound();
        var refOwned = await db.ReferenceTracks
            .AnyAsync(r => r.Id == body.ReferenceId && r.UserId == userId, ct);
        if (!refOwned) return Results.NotFound();

        var existing = await db.ReferenceSetMembers
            .AnyAsync(m => m.SetId == setId && m.ReferenceId == body.ReferenceId, ct);
        if (existing) return Results.NoContent();

        db.ReferenceSetMembers.Add(new ReferenceSetMember
        {
            SetId = setId,
            ReferenceId = body.ReferenceId,
        });
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    private static async Task<IResult> RemoveMember(
        Guid setId,
        Guid referenceId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var setOwned = await db.ReferenceSets
            .AnyAsync(s => s.Id == setId && s.UserId == userId, ct);
        if (!setOwned) return Results.NotFound();

        var deleted = await db.ReferenceSetMembers
            .Where(m => m.SetId == setId && m.ReferenceId == referenceId)
            .ExecuteDeleteAsync(ct);
        return deleted > 0 ? Results.NoContent() : Results.NotFound();
    }

    // ── helpers ──────────────────────────────────────────────────────────────
    private static ReferenceDto ToDto(ReferenceTrack r, IReadOnlyList<Guid>? setIds = null) => new(
        r.Id, r.Title, r.Artist, r.Source, r.FilePath, r.Genre,
        r.Bpm, r.DetectedKey, r.DurationSeconds, r.Lufs, r.TruePeakDb,
        r.DynamicRangeLu, r.StereoWidth, r.StereoCorrelation,
        ParseJsonElement(r.BandLevels),
        ParseJsonElement(r.Tags) ?? EmptyArray(),
        r.Analyzed, r.AnalysisStatus, r.AnalysisError, r.UsedCount, r.Notes, r.CreatedAt,
        setIds ?? Array.Empty<Guid>());

    // Set ids a single reference belongs to (for the patch/get-by-id responses).
    private static async Task<List<Guid>> SetIdsForAsync(AppDbContext db, Guid referenceId, CancellationToken ct) =>
        await db.ReferenceSetMembers.AsNoTracking()
            .Where(m => m.ReferenceId == referenceId)
            .Select(m => m.SetId)
            .ToListAsync(ct);

    private static JsonElement? ParseJsonElement(string? raw)
    {
        if (string.IsNullOrEmpty(raw)) return null;
        try
        {
            using var doc = JsonDocument.Parse(raw);
            return doc.RootElement.Clone();
        }
        catch (JsonException) { return null; }
    }

    private static JsonElement EmptyArray()
    {
        using var doc = JsonDocument.Parse("[]");
        return doc.RootElement.Clone();
    }
}
