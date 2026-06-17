using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Data;
using System.Security.Claims;
using System.Text.Json;

namespace Spectr.Bff.Endpoints;

public static class ReportsEndpoints
{
    public static IEndpointRouteBuilder MapReportsEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/reports").WithTags("reports").RequireAuthorization();
        g.MapGet("/", List);
        return app;
    }

    private static async Task<IResult> List(
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct,
        [FromQuery(Name = "songName")] string? songName = null,
        [FromQuery(Name = "tags")] string? tags = null,
        [FromQuery(Name = "genreHint")] string? genreHint = null,
        [FromQuery(Name = "startDate")] DateTimeOffset? startDate = null,
        [FromQuery(Name = "endDate")] DateTimeOffset? endDate = null,
        [FromQuery(Name = "page")] int page = 1,
        [FromQuery(Name = "pageSize")] int pageSize = 25)
    {
        if (page < 1) page = 1;
        pageSize = Math.Clamp(pageSize, 1, 100);

        var userId = currentUser.UserId();

        // Build base query: analysis_jobs → song_versions → songs (all owned by user)
        var q = db.AnalysisJobs.AsNoTracking()
            .Where(j => j.UserId == userId);

        // Filter by date range on dispatched_at
        if (startDate.HasValue) q = q.Where(j => j.DispatchedAt >= startDate.Value);
        if (endDate.HasValue)   q = q.Where(j => j.DispatchedAt <= endDate.Value);

        // Join to versions and songs for name/genre filters
        var joined = q
            .Join(db.SongVersions.AsNoTracking(),
                j => j.VersionId,
                v => v.Id,
                (j, v) => new { Job = j, Version = v })
            .Join(db.Songs.AsNoTracking(),
                jv => jv.Version.SongId,
                s => s.Id,
                (jv, s) => new { jv.Job, jv.Version, Song = s });

        // ILike filters (case-insensitive substring)
        if (!string.IsNullOrWhiteSpace(songName))
        {
            var pattern = $"%{songName.Trim()}%";
            joined = joined.Where(x => EF.Functions.ILike(x.Song.Name, pattern));
        }
        if (!string.IsNullOrWhiteSpace(genreHint))
        {
            var pattern = $"%{genreHint.Trim()}%";
            joined = joined.Where(x => x.Song.GenreHint != null &&
                                       EF.Functions.ILike(x.Song.GenreHint, pattern));
        }

        // Tag filter: song must have ALL requested tags (case-insensitive)
        var tagList = (tags ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(t => t.Length > 0)
            .ToList();

        if (tagList.Count > 0)
        {
            // Each tag in tagList must exist on the song (owned by anyone visible to the user)
            foreach (var tagName in tagList)
            {
                var t = tagName; // capture for EF query
                joined = joined.Where(x =>
                    db.SongTags.Any(st =>
                        st.SongId == x.Song.Id &&
                        EF.Functions.ILike(st.Name, t) &&
                        (st.UserId == userId || st.IsPublic)));
            }
        }

        var total = await joined.CountAsync(ct);

        var rows = await joined
            .OrderByDescending(x => x.Job.DispatchedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(ct);

        if (rows.Count == 0)
            return Results.Ok(new ReportListResponse(Array.Empty<ReportListItemDto>(), total, page, pageSize));

        // Batch-load analyses for grade/score (complete jobs only)
        var jobIds = rows.Select(r => r.Job.Id).ToList();
        var analyses = await db.Analyses.AsNoTracking()
            .Where(a => jobIds.Contains(a.JobId))
            .Select(a => new { a.JobId, a.FinalJson })
            .ToListAsync(ct);
        var analysisByJob = analyses.ToDictionary(a => a.JobId, a => a.FinalJson);

        // Batch-load tags for the songs in this page
        var songIds = rows.Select(r => r.Song.Id).Distinct().ToList();
        var allTags = await db.SongTags.AsNoTracking()
            .Where(t => songIds.Contains(t.SongId) && (t.UserId == userId || t.IsPublic))
            .ToListAsync(ct);
        var tagsBySong = allTags
            .GroupBy(t => t.SongId)
            .ToDictionary(g => g.Key, g => g.Select(t => new TagDto(t.Id, t.Name, t.IsPublic)).ToList());

        var items = rows.Select(r =>
        {
            var (grade, score) = ExtractGradeScore(analysisByJob.GetValueOrDefault(r.Job.Id));
            return new ReportListItemDto(
                JobId: r.Job.Id,
                VersionId: r.Version.Id,
                VersionNumber: r.Version.VersionNumber,
                VersionLabel: r.Version.Label,
                SongId: r.Song.Id,
                SongName: r.Song.Name,
                GenreHint: r.Song.GenreHint,
                Status: r.Job.Status,
                Grade: grade,
                Score: score,
                Tags: tagsBySong.TryGetValue(r.Song.Id, out var st)
                    ? (IReadOnlyList<TagDto>)st
                    : Array.Empty<TagDto>(),
                DispatchedAt: r.Job.DispatchedAt,
                CompletedAt: r.Job.CompletedAt);
        }).ToList();

        return Results.Ok(new ReportListResponse(items, total, page, pageSize));
    }

    private static (string? grade, double? score) ExtractGradeScore(string? finalJson)
    {
        if (string.IsNullOrEmpty(finalJson)) return (null, null);
        try
        {
            using var doc = JsonDocument.Parse(finalJson);
            string? grade = null;
            double? score = null;
            if (doc.RootElement.TryGetProperty("grade", out var g) &&
                g.ValueKind == JsonValueKind.String)
                grade = g.GetString();
            if (doc.RootElement.TryGetProperty("mix_score", out var ms) &&
                ms.ValueKind == JsonValueKind.Number)
                score = ms.GetDouble();
            return (grade, score);
        }
        catch (JsonException) { return (null, null); }
    }
}
