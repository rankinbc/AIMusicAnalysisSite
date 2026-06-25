using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Security.Claims;
using System.Text.Json;

namespace Spectr.Bff.Endpoints;

// Listen V3 (PRP-1). Server-backed rack presets + the autosaved rack draft
// (both VERSION-scoped — owner derives via song_version -> song -> user, NO
// user_id) and user-scoped viz presets. The apply-to-graph loop lives on the
// frontend (chainApply.ts); this group is pure persistence + IDOR scoping.
public static class RackPresetEndpoints
{
    private const int MaxNameLength = 120;

    public static IEndpointRouteBuilder MapRackPresetEndpoints(this IEndpointRouteBuilder app)
    {
        // Rack presets + draft hang off a version: ownership is the version's.
        var rack = app.MapGroup("/versions/{versionId:guid}/rack")
            .WithTags("rack").RequireAuthorization();
        rack.MapGet("/presets", ListPresets);
        rack.MapPost("/presets", SavePreset);
        rack.MapDelete("/presets/{presetId:guid}", DeletePreset);
        rack.MapGet("/draft", GetDraft);
        rack.MapPut("/draft", UpsertDraft);

        // Viz presets are user-scoped "looks" — not bound to any version.
        var viz = app.MapGroup("/viz").WithTags("viz").RequireAuthorization();
        viz.MapGet("/presets", ListViz);
        viz.MapPost("/presets", SaveViz);
        viz.MapDelete("/presets/{presetId:guid}", DeleteViz);

        return app;
    }

    // ── Ownership probe ──────────────────────────────────────────────────────
    // Tracked (NOT AsNoTracking): AsNoTracking anywhere makes the whole query
    // no-tracking, which would silently drop a later SaveChanges on the draft
    // upsert. AnyAsync doesn't materialize a row to mutate, but we keep the
    // pattern uniform with the write paths in VersionEndpoints.
    private static Task<bool> OwnsVersion(
        AppDbContext db, Guid versionId, Guid userId, CancellationToken ct) =>
        (from v in db.SongVersions
         join s in db.Songs on v.SongId equals s.Id
         where v.Id == versionId && s.UserId == userId
         select v.Id).AnyAsync(ct);

    private static JsonElement Parse(string raw)
    {
        using var doc = JsonDocument.Parse(string.IsNullOrEmpty(raw) ? "{}" : raw);
        return doc.RootElement.Clone();
    }

    // ── Rack presets ─────────────────────────────────────────────────────────
    // GET — the owner's personal library: source='user' only. coach/analysis
    // rows (once a generator exists) surface via their own audition flow.
    private static async Task<IResult> ListPresets(
        Guid versionId, ClaimsPrincipal currentUser, AppDbContext db, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        if (!await OwnsVersion(db, versionId, userId, ct)) return Results.NotFound();

        var rows = await db.RackPresets.AsNoTracking()
            .Where(p => p.SongVersionId == versionId && p.Source == "user")
            .OrderByDescending(p => p.UpdatedAt)
            .ToListAsync(ct);
        return Results.Ok(rows.Select(ToDto).ToList());
    }

    private static async Task<IResult> SavePreset(
        Guid versionId, SaveRackPresetRequest body, ClaimsPrincipal currentUser,
        AppDbContext db, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        if (!await OwnsVersion(db, versionId, userId, ct)) return Results.NotFound();

        var name = (body?.Name ?? "").Trim();
        if (string.IsNullOrEmpty(name))
            return Results.BadRequest(new { error = "Name is required." });
        if (name.Length > MaxNameLength) name = name[..MaxNameLength];
        if (body!.Chain.ValueKind != JsonValueKind.Object)
            return Results.BadRequest(new { error = "Chain must be a JSON object." });

        var row = new RackPreset
        {
            Id = Guid.NewGuid(),
            SongVersionId = versionId,
            Name = name,
            Source = "user",
            ChainJson = body.Chain.GetRawText(),
        };
        db.RackPresets.Add(row);
        await db.SaveChangesAsync(ct);
        return Results.Created(
            $"/api/versions/{versionId}/rack/presets/{row.Id}", ToDto(row));
    }

    private static async Task<IResult> DeletePreset(
        Guid versionId, Guid presetId, ClaimsPrincipal currentUser,
        AppDbContext db, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        if (!await OwnsVersion(db, versionId, userId, ct)) return Results.NotFound();

        var deleted = await db.RackPresets
            .Where(p => p.Id == presetId && p.SongVersionId == versionId)
            .ExecuteDeleteAsync(ct);
        return deleted > 0 ? Results.NoContent() : Results.NotFound();
    }

    // ── Rack draft (one per version) ─────────────────────────────────────────
    private static async Task<IResult> GetDraft(
        Guid versionId, ClaimsPrincipal currentUser, AppDbContext db, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        if (!await OwnsVersion(db, versionId, userId, ct)) return Results.NotFound();

        var row = await db.RackDrafts.AsNoTracking()
            .FirstOrDefaultAsync(d => d.SongVersionId == versionId, ct);
        // No draft yet → 204 (the frontend treats this as "nothing to restore").
        return row is null
            ? Results.NoContent()
            : Results.Ok(new RackDraftDto(row.SongVersionId, Parse(row.ChainJson), row.UpdatedAt));
    }

    private static async Task<IResult> UpsertDraft(
        Guid versionId, UpsertRackDraftRequest body, ClaimsPrincipal currentUser,
        AppDbContext db, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        if (!await OwnsVersion(db, versionId, userId, ct)) return Results.NotFound();
        if (body is null || body.Chain.ValueKind != JsonValueKind.Object)
            return Results.BadRequest(new { error = "Chain must be a JSON object." });

        // Tracked lookup + mutate, or insert — UNIQUE(song_version_id) keeps it 1:1.
        var row = await db.RackDrafts
            .FirstOrDefaultAsync(d => d.SongVersionId == versionId, ct);
        if (row is null)
        {
            row = new RackDraft
            {
                Id = Guid.NewGuid(),
                SongVersionId = versionId,
                ChainJson = body.Chain.GetRawText(),
            };
            db.RackDrafts.Add(row);
        }
        else
        {
            row.ChainJson = body.Chain.GetRawText();
            row.UpdatedAt = DateTimeOffset.UtcNow;
        }
        await db.SaveChangesAsync(ct);
        return Results.Ok(new RackDraftDto(row.SongVersionId, Parse(row.ChainJson), row.UpdatedAt));
    }

    // ── Viz presets (user-scoped) ────────────────────────────────────────────
    private static async Task<IResult> ListViz(
        ClaimsPrincipal currentUser, AppDbContext db, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var rows = await db.VizPresets.AsNoTracking()
            .Where(p => p.UserId == userId)
            .OrderByDescending(p => p.UpdatedAt)
            .ToListAsync(ct);
        return Results.Ok(rows
            .Select(p => new VizPresetDto(p.Id, p.Name, Parse(p.VizJson), p.CreatedAt, p.UpdatedAt))
            .ToList());
    }

    private static async Task<IResult> SaveViz(
        SaveVizPresetRequest body, ClaimsPrincipal currentUser, AppDbContext db, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var name = (body?.Name ?? "").Trim();
        if (string.IsNullOrEmpty(name))
            return Results.BadRequest(new { error = "Name is required." });
        if (name.Length > MaxNameLength) name = name[..MaxNameLength];
        if (body!.Viz.ValueKind != JsonValueKind.Object)
            return Results.BadRequest(new { error = "Viz must be a JSON object." });

        var row = new VizPreset
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Name = name,
            VizJson = body.Viz.GetRawText(),
        };
        db.VizPresets.Add(row);
        await db.SaveChangesAsync(ct);
        return Results.Created(
            $"/api/viz/presets/{row.Id}",
            new VizPresetDto(row.Id, row.Name, Parse(row.VizJson), row.CreatedAt, row.UpdatedAt));
    }

    private static async Task<IResult> DeleteViz(
        Guid presetId, ClaimsPrincipal currentUser, AppDbContext db, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var deleted = await db.VizPresets
            .Where(p => p.Id == presetId && p.UserId == userId)
            .ExecuteDeleteAsync(ct);
        return deleted > 0 ? Results.NoContent() : Results.NotFound();
    }

    private static RackPresetDto ToDto(RackPreset p) => new(
        p.Id, p.SongVersionId, p.Name, p.Source, Parse(p.ChainJson),
        p.CreatedInSessionId, p.ViaGrantId, p.CreatedAt, p.UpdatedAt);
}
