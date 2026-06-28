using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Bff.Support;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Security.Claims;
using System.Text.Json;

namespace Spectr.Bff.Endpoints;

public static class SongEndpoints
{
    public static IEndpointRouteBuilder MapSongEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/songs").WithTags("songs").RequireAuthorization();

        g.MapGet("/", List);
        g.MapPost("/", Create);
        g.MapGet("/{songId:guid}", GetById);
        g.MapPatch("/{songId:guid}", Patch);
        g.MapDelete("/{songId:guid}", Archive);
        g.MapDelete("/{songId:guid}/permanent", HardDelete);
        g.MapPost("/{songId:guid}/restore", Restore);
        g.MapPost("/{songId:guid}/tags", AddTag);
        g.MapDelete("/{songId:guid}/tags/{tagId:guid}", RemoveTag);

        return app;
    }

    private static async Task<IResult> List(
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct,
        [FromQuery(Name = "include")] string? include = null,
        [FromQuery(Name = "include_archived")] bool includeArchived = false)
    {
        var userId = currentUser.UserId();
        var includeVersions = include?.Contains("versions") ?? false;
        var includeResults = include?.Contains("latest_result") ?? false;

        var songsQ = db.Songs.AsNoTracking().Where(s => s.UserId == userId);
        if (!includeArchived) songsQ = songsQ.Where(s => s.ArchivedAt == null);
        var songs = await songsQ.OrderByDescending(s => s.UpdatedAt).ToListAsync(ct);
        if (songs.Count == 0) return Results.Ok(Array.Empty<SongDto>());

        var songIds = songs.Select(s => s.Id).ToList();

        var versions = includeVersions
            ? await db.SongVersions.AsNoTracking()
                .Where(v => songIds.Contains(v.SongId))
                .OrderByDescending(v => v.VersionNumber)
                .ToListAsync(ct)
            : new List<SongVersion>();

        var latest = includeResults
            ? await db.Analyses.AsNoTracking()
                .Where(a => a.UserId == userId && a.SongId != null && songIds.Contains(a.SongId!.Value))
                .GroupBy(a => a.SongId!.Value)
                .Select(g => g.OrderByDescending(a => a.CreatedAt).First())
                .ToListAsync(ct)
            : new List<Analysis>();

        var allTags = await db.SongTags.AsNoTracking()
            .Where(t => songIds.Contains(t.SongId) && t.UserId == userId)
            .ToListAsync(ct);
        var tagsBySong = allTags
            .GroupBy(t => t.SongId)
            .ToDictionary(g => g.Key, g => g.Select(t => new TagDto(t.Id, t.Name, t.IsPublic)).ToList());

        var dto = songs.Select(s => BuildSongDto(
            s,
            versions.Where(v => v.SongId == s.Id).Select(v => ToVersionDto(v, null, null)).ToList(),
            latest.Where(a => a.SongId == s.Id).Select(ToSummaryDto).FirstOrDefault(),
            tagsBySong.TryGetValue(s.Id, out var st) ? (IReadOnlyList<TagDto>)st : Array.Empty<TagDto>()
        )).ToList();

        return Results.Ok(dto);
    }

    private static async Task<IResult> Create(
        CreateSongRequest req,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Name))
            return Results.ValidationProblem(new Dictionary<string, string[]>
                { ["name"] = ["Name required."] });

        var userId = currentUser.UserId();
        var song = new Song
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Name = req.Name.Trim(),
            GenreHint = string.IsNullOrWhiteSpace(req.GenreHint) ? null : req.GenreHint.Trim(),
            // Visibility is NOT settable on create — always defaults to 'private'.
            Description = Clean(req.Description),
            VisualTemplate = Clean(req.VisualTemplate),
            VisualPrimary = Clean(req.VisualPrimary),
            VisualSecondary = Clean(req.VisualSecondary),
            ReferenceProfileKind = Clean(req.ReferenceProfileKind),
            ReferenceProfileId = Clean(req.ReferenceProfileId),
        };
        db.Songs.Add(song);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            return Results.Conflict(new { error = "A song with that name already exists." });
        }

        return Results.Created($"/api/songs/{song.Id}",
            BuildSongDto(song, Array.Empty<VersionDto>(), null, Array.Empty<TagDto>()));
    }

    private static async Task<IResult> GetById(
        Guid songId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var song = await db.Songs.AsNoTracking()
            .FirstOrDefaultAsync(s => s.Id == songId && s.UserId == userId, ct);
        if (song is null) return Results.NotFound();

        var versions = await db.SongVersions.AsNoTracking()
            .Where(v => v.SongId == songId)
            .OrderByDescending(v => v.VersionNumber)
            .ToListAsync(ct);
        var latest = await db.Analyses.AsNoTracking()
            .Where(a => a.UserId == userId && a.SongId == songId)
            .OrderByDescending(a => a.CreatedAt)
            .FirstOrDefaultAsync(ct);
        var tags = await db.SongTags.AsNoTracking()
            .Where(t => t.SongId == songId && t.UserId == userId)
            .ToListAsync(ct);

        // Batch-load the newest analysis per version so each VersionDto can
        // carry its own metrics without N+1 queries.
        var versionIds = versions.Select(v => v.Id).ToList();
        var perVersionLatest = await db.Analyses.AsNoTracking()
            .Where(a => a.UserId == userId && a.VersionId != null && versionIds.Contains(a.VersionId!.Value))
            .GroupBy(a => a.VersionId!.Value)
            .Select(g => g.OrderByDescending(a => a.CreatedAt).First())
            .ToListAsync(ct);
        var metricsByVersion = perVersionLatest.ToDictionary(
            a => a.VersionId!.Value,
            a => FinalJsonMetrics.Read(a.FinalJson));

        return Results.Ok(BuildSongDto(
            song,
            versions.Select(v => ToVersionDto(v, metricsByVersion.GetValueOrDefault(v.Id), null)).ToList(),
            latest is null ? null : ToSummaryDto(latest),
            tags.Select(t => new TagDto(t.Id, t.Name, t.IsPublic)).ToList()));
    }

    private static async Task<IResult> Patch(
        Guid songId,
        PatchSongRequest req,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        // Tracked lookup (NOT AsNoTracking) so SaveChanges persists the update.
        var song = await db.Songs.FirstOrDefaultAsync(s => s.Id == songId && s.UserId == userId, ct);
        if (song is null) return Results.NotFound();

        if (req.Visibility is not null)
        {
            if (!AllowedVisibilities.Contains(req.Visibility))
                return ErrorEnvelope.Build(400, "invalid_visibility",
                    "Visibility must be one of: private, shared, public.",
                    new { allowed = AllowedVisibilities });
            song.Visibility = req.Visibility;
        }
        if (req.Name is not null)
        {
            var trimmed = req.Name.Trim();
            if (trimmed.Length == 0) return Results.BadRequest(new { error = "Name cannot be empty." });
            song.Name = trimmed;
        }
        if (req.GenreHint is not null)
        {
            song.GenreHint = string.IsNullOrWhiteSpace(req.GenreHint) ? null : req.GenreHint.Trim();
        }
        if (req.Description is not null) song.Description = Clean(req.Description);
        if (req.VisualTemplate is not null) song.VisualTemplate = Clean(req.VisualTemplate);
        if (req.VisualPrimary is not null) song.VisualPrimary = Clean(req.VisualPrimary);
        if (req.VisualSecondary is not null) song.VisualSecondary = Clean(req.VisualSecondary);
        if (req.ReferenceProfileKind is not null) song.ReferenceProfileKind = Clean(req.ReferenceProfileKind);
        if (req.ReferenceProfileId is not null) song.ReferenceProfileId = Clean(req.ReferenceProfileId);
        song.UpdatedAt = DateTimeOffset.UtcNow;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            return Results.Conflict(new { error = "A song with that name already exists." });
        }

        return Results.NoContent();
    }

    private static async Task<IResult> Archive(
        Guid songId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var song = await db.Songs.FirstOrDefaultAsync(s => s.Id == songId && s.UserId == userId, ct);
        if (song is null) return Results.NotFound();

        song.ArchivedAt = DateTimeOffset.UtcNow;
        song.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    // ── DELETE /api/songs/{songId}/permanent — owner-scoped HARD delete ───────
    // Permanently removes the song, all its versions, and every dependent row,
    // then best-effort deletes the stored audio blobs. The archive endpoint
    // (DELETE /api/songs/{songId}) is unchanged and only sets archived_at.
    private static async Task<IResult> HardDelete(
        Guid songId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IFileStorage storage,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var song = await db.Songs.FirstOrDefaultAsync(s => s.Id == songId && s.UserId == userId, ct);
        if (song is null) return Results.NotFound();

        // Gather versions (+ blob keys) before any row is removed.
        var versions = await db.SongVersions.AsNoTracking()
            .Where(v => v.SongId == songId)
            .ToListAsync(ct);
        var versionIds = versions.Select(v => v.Id).ToList();

        var blobKeys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var v in versions)
        {
            if (!string.IsNullOrEmpty(v.FilePath)) blobKeys.Add(v.FilePath);
            if (!string.IsNullOrEmpty(v.AlsFilePath)) blobKeys.Add(v.AlsFilePath!);
            if (!string.IsNullOrEmpty(v.ReferencePath)) blobKeys.Add(v.ReferencePath!);
            foreach (var key in ExtractStemKeys(v.StemPathsRaw, v.StemPaths)) blobKeys.Add(key);
        }

        // analyses tied to this song directly or via one of its versions.
        var analysisIds = await db.Analyses.AsNoTracking()
            .Where(a => a.SongId == songId
                || (a.VersionId != null && versionIds.Contains(a.VersionId.Value)))
            .Select(a => a.Id)
            .ToListAsync(ct);

        // Many of these relationships carry NO DB-level FK (analyses, analysis_jobs,
        // verdicts, conversations, session_notes, compare_cache — see AppDbContext:
        // only the V3 version-scoped tables + song_tags declare cascade FKs). So we
        // delete those explicitly, child-first, inside one transaction. Deleting the
        // song_versions rows then DB-cascades rack_presets/drafts, share_settings,
        // invites, listening_sessions(+control_grants), track_comments, suggestions;
        // deleting the song DB-cascades song_tags.
        await using var tx = await db.Database.BeginTransactionAsync(ct);

        if (analysisIds.Count > 0)
        {
            var convIds = await db.Conversations
                .Where(c => analysisIds.Contains(c.AnalysisId)).Select(c => c.Id).ToListAsync(ct);
            if (convIds.Count > 0)
                await db.CoachMessages.Where(m => convIds.Contains(m.ConversationId)).ExecuteDeleteAsync(ct);
            await db.Conversations.Where(c => analysisIds.Contains(c.AnalysisId)).ExecuteDeleteAsync(ct);

            var verdictIds = await db.Verdicts
                .Where(vd => analysisIds.Contains(vd.AnalysisId)).Select(vd => vd.Id).ToListAsync(ct);
            if (verdictIds.Count > 0)
                await db.VerdictUserStates.Where(s => verdictIds.Contains(s.VerdictId)).ExecuteDeleteAsync(ct);
            await db.Verdicts.Where(vd => analysisIds.Contains(vd.AnalysisId)).ExecuteDeleteAsync(ct);

            await db.Analyses.Where(a => analysisIds.Contains(a.Id)).ExecuteDeleteAsync(ct);
        }

        if (versionIds.Count > 0)
        {
            await db.AnalysisJobs
                .Where(j => j.VersionId != null && versionIds.Contains(j.VersionId.Value))
                .ExecuteDeleteAsync(ct);
            await db.SessionNotes.Where(n => versionIds.Contains(n.VersionId)).ExecuteDeleteAsync(ct);
            await db.CompareCaches.Where(c => versionIds.Contains(c.TrackVersionId)).ExecuteDeleteAsync(ct);
            await db.SongVersions.Where(v => versionIds.Contains(v.Id)).ExecuteDeleteAsync(ct);
        }

        await db.Songs.Where(s => s.Id == songId && s.UserId == userId).ExecuteDeleteAsync(ct);
        await tx.CommitAsync(ct);

        // Best-effort blob cleanup — a missing blob must never fail the delete.
        foreach (var key in blobKeys)
        {
            try { await storage.DeleteAsync(key, ct); }
            catch { /* orphaned/missing blob is harmless; rows are already gone */ }
        }

        return Results.NoContent();
    }

    private static async Task<IResult> Restore(
        Guid songId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var song = await db.Songs.FirstOrDefaultAsync(s => s.Id == songId && s.UserId == userId, ct);
        if (song is null) return Results.NotFound();

        song.ArchivedAt = null;
        song.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    private static async Task<IResult> AddTag(
        Guid songId,
        CreateTagRequest req,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var name = req.Name?.Trim() ?? string.Empty;
        if (name.Length == 0 || name.Length > 64)
            return Results.ValidationProblem(new Dictionary<string, string[]>
                { ["name"] = ["Tag name must be 1–64 characters."] });

        var userId = currentUser.UserId();
        var song = await db.Songs.AsNoTracking()
            .FirstOrDefaultAsync(s => s.Id == songId && s.UserId == userId, ct);
        if (song is null) return Results.NotFound();

        var tagCount = await db.SongTags.CountAsync(t => t.SongId == songId && t.UserId == userId, ct);
        if (tagCount >= 20)
            return Results.UnprocessableEntity(new { error = "Maximum 20 tags per song." });

        var tag = new SongTag { SongId = songId, UserId = userId, Name = name, IsPublic = req.IsPublic };
        db.SongTags.Add(tag);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            return Results.Conflict(new { error = "Tag already exists." });
        }

        return Results.Created($"/api/songs/{songId}/tags/{tag.Id}",
            new TagDto(tag.Id, tag.Name, tag.IsPublic));
    }

    private static async Task<IResult> RemoveTag(
        Guid songId,
        Guid tagId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var tag = await db.SongTags
            .FirstOrDefaultAsync(t => t.Id == tagId && t.SongId == songId && t.UserId == userId, ct);
        if (tag is null) return Results.NotFound();

        db.SongTags.Remove(tag);
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    // ── helpers ───────────────────────────────────────────────────────────────
    private static readonly string[] AllowedVisibilities = { "private", "shared", "public" };

    // Trim + collapse blanks to null for the optional TEXT metadata columns.
    private static string? Clean(string? s) =>
        string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static SongDto BuildSongDto(
        Song s,
        IReadOnlyList<VersionDto> versions,
        AnalysisSummaryDto? latest,
        IReadOnlyList<TagDto> tags) =>
        new(s.Id, s.Name, s.GenreHint, s.CreatedAt, s.UpdatedAt, s.ArchivedAt,
            versions, latest, tags,
            s.Visibility, s.Description, s.VisualTemplate, s.VisualPrimary,
            s.VisualSecondary, s.ReferenceProfileKind, s.ReferenceProfileId);

    // Pulls every stored stem blob key out of a version's JSONB columns.
    // stem_paths_raw = [{ "key": "...", ... }]; stem_paths = { role: ["key", ...] }
    // (legacy { role: "key" } also accepted).
    private static IEnumerable<string> ExtractStemKeys(string? stemPathsRaw, string? stemPaths)
    {
        if (!string.IsNullOrWhiteSpace(stemPathsRaw))
        {
            JsonDocument? doc = null;
            try { doc = JsonDocument.Parse(stemPathsRaw); } catch (JsonException) { }
            if (doc is not null)
            {
                using (doc)
                {
                    if (doc.RootElement.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var el in doc.RootElement.EnumerateArray())
                        {
                            if (el.ValueKind == JsonValueKind.Object
                                && el.TryGetProperty("key", out var k)
                                && k.ValueKind == JsonValueKind.String)
                            {
                                var key = k.GetString();
                                if (!string.IsNullOrEmpty(key)) yield return key;
                            }
                        }
                    }
                }
            }
        }

        if (!string.IsNullOrWhiteSpace(stemPaths))
        {
            JsonDocument? doc = null;
            try { doc = JsonDocument.Parse(stemPaths); } catch (JsonException) { }
            if (doc is not null)
            {
                using (doc)
                {
                    if (doc.RootElement.ValueKind == JsonValueKind.Object)
                    {
                        foreach (var prop in doc.RootElement.EnumerateObject())
                        {
                            if (prop.Value.ValueKind == JsonValueKind.String)
                            {
                                var key = prop.Value.GetString();
                                if (!string.IsNullOrEmpty(key)) yield return key;
                            }
                            else if (prop.Value.ValueKind == JsonValueKind.Array)
                            {
                                foreach (var item in prop.Value.EnumerateArray())
                                {
                                    if (item.ValueKind == JsonValueKind.String)
                                    {
                                        var key = item.GetString();
                                        if (!string.IsNullOrEmpty(key)) yield return key;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    internal static VersionDto ToVersionDto(SongVersion v, VersionMetricsDto? metrics, int? personalScore) =>
        new(v.Id, v.SongId, v.VersionNumber, v.Label, v.IsCurrent, v.FilePath, v.CreatedAt,
            v.AlsFilePath, v.ReferencePath, metrics, personalScore);

    internal static AnalysisSummaryDto ToSummaryDto(Analysis a)
    {
        string? grade = null;
        double? score = null;
        try
        {
            using var doc = JsonDocument.Parse(a.FinalJson);
            if (doc.RootElement.TryGetProperty("mix_score", out var ms) &&
                ms.ValueKind == JsonValueKind.Number)
            {
                score = ms.GetDouble();
            }
            if (doc.RootElement.TryGetProperty("grade", out var g) &&
                g.ValueKind == JsonValueKind.String)
            {
                grade = g.GetString();
            }
        }
        catch (JsonException) { /* tolerate malformed final_json */ }
        return new AnalysisSummaryDto(a.Id, a.JobId, a.CreatedAt, grade, score);
    }

    private static bool IsUniqueViolation(DbUpdateException ex) =>
        ex.InnerException is Npgsql.PostgresException pg && pg.SqlState == "23505";
}
