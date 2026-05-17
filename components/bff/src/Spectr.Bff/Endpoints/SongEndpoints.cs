using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
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
        g.MapPost("/{songId:guid}/restore", Restore);

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

        var dto = songs.Select(s => new SongDto(
            s.Id,
            s.Name,
            s.GenreHint,
            s.CreatedAt,
            s.UpdatedAt,
            s.ArchivedAt,
            versions.Where(v => v.SongId == s.Id).Select(ToVersionDto).ToList(),
            latest.Where(a => a.SongId == s.Id).Select(ToSummaryDto).FirstOrDefault()
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
            new SongDto(song.Id, song.Name, song.GenreHint, song.CreatedAt, song.UpdatedAt,
                song.ArchivedAt, Array.Empty<VersionDto>(), null));
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

        return Results.Ok(new SongDto(
            song.Id, song.Name, song.GenreHint, song.CreatedAt, song.UpdatedAt, song.ArchivedAt,
            versions.Select(ToVersionDto).ToList(),
            latest is null ? null : ToSummaryDto(latest)));
    }

    private static async Task<IResult> Patch(
        Guid songId,
        PatchSongRequest req,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var song = await db.Songs.FirstOrDefaultAsync(s => s.Id == songId && s.UserId == userId, ct);
        if (song is null) return Results.NotFound();

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

    // ── helpers ───────────────────────────────────────────────────────────────
    private static VersionDto ToVersionDto(SongVersion v) =>
        new(v.Id, v.SongId, v.VersionNumber, v.Label, v.IsCurrent, v.FilePath, v.CreatedAt);

    private static AnalysisSummaryDto ToSummaryDto(Analysis a)
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
