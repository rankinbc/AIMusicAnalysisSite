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
        refs.MapPost("/", Upload)
            .DisableAntiforgery()
            .WithMetadata(new RequestSizeLimitAttribute(MaxUploadBytes));
        refs.MapGet("/{referenceId:guid}", GetById);
        refs.MapPatch("/{referenceId:guid}", Patch);
        refs.MapDelete("/{referenceId:guid}", Delete);
        refs.MapPost("/{referenceId:guid}/analyze", Analyze);

        var sets = app.MapGroup("/reference-sets").WithTags("reference-sets").RequireAuthorization();
        sets.MapGet("/", ListSets);
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
        return Results.Ok(rows.Select(ToDto).ToList());
    }

    private static async Task<IResult> Upload(
        [FromForm] IFormFile file,
        [FromForm(Name = "title")] string? title,
        [FromForm(Name = "artist")] string? artist,
        [FromForm(Name = "genre")] string? genre,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IFileStorage storage,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
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
        return Results.Ok(ToDto(row));
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
        return Results.Ok(ToDto(row));
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
            try { await storage.DeleteAsync(key, ct); }
            catch { /* orphaned file is harmless once row is gone */ }
        }
        return Results.NoContent();
    }

    private static async Task<IResult> Analyze(
        Guid referenceId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IJobQueue queue,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var row = await db.ReferenceTracks.AsNoTracking()
            .FirstOrDefaultAsync(r => r.Id == referenceId && r.UserId == userId, ct);
        if (row is null) return Results.NotFound();
        if (string.IsNullOrEmpty(row.FilePath))
            return Results.BadRequest(new { error = "Reference has no file to analyze." });

        // Enqueue the dedicated reference-analyzer actor; it'll populate
        // BPM/LUFS/etc. and flip `analyzed=true` on success.
        await queue.EnqueueAsync(
            DramatiqTasks.RunReferenceAnalyzer,
            new object[] { referenceId.ToString() },
            ct);
        return Results.Accepted(value: ToDto(row));
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
        var dtos = sets.Select(s => new ReferenceSetDto(
            s.Id, s.Name, s.Hue,
            counts.TryGetValue(s.Id, out var c) ? c : 0,
            s.CreatedAt)).ToList();
        return Results.Ok(dtos);
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
            new ReferenceSetDto(row.Id, row.Name, row.Hue, 0, row.CreatedAt));
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
        return Results.Ok(new ReferenceSetDto(row.Id, row.Name, row.Hue, count, row.CreatedAt));
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
    private static ReferenceDto ToDto(ReferenceTrack r) => new(
        r.Id, r.Title, r.Artist, r.Source, r.FilePath, r.Genre,
        r.Bpm, r.DetectedKey, r.DurationSeconds, r.Lufs, r.TruePeakDb,
        r.DynamicRangeLu, r.StereoWidth, r.StereoCorrelation,
        ParseJsonElement(r.BandLevels),
        ParseJsonElement(r.Tags) ?? EmptyArray(),
        r.Analyzed, r.UsedCount, r.Notes, r.CreatedAt);

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
