using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using System.Security.Claims;
using System.Text.Json;

namespace Spectr.Bff.Endpoints;

// Deterministic SOLVE: turn an analysis's persisted Problems into a loadable
// rack preset. On-demand — POST enqueues the `generate_fix_rack` worker actor,
// which writes a system RackPreset(source='analysis'); GET serves it once ready.
public static class FixRackEndpoints
{
    public static IEndpointRouteBuilder MapFixRackEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/reports/{jobId:guid}/fix-rack").WithTags("fix-rack").RequireAuthorization();
        g.MapPost("/", Generate).AllowGuest(); // Task D6 (spec D4)
        g.MapGet("/", GetFixRack);
        return app;
    }

    // POST /api/reports/{jobId}/fix-rack — enqueue rack generation.
    private static async Task<IResult> Generate(
        Guid jobId, ClaimsPrincipal user, AppDbContext db, IJobQueue queue,
        EntitlementService ents, CancellationToken ct)
    {
        var userId = user.UserId();
        var analysis = await db.Analyses.AsNoTracking()
            .Where(a => a.JobId == jobId && a.UserId == userId)
            .Select(a => new { a.Id, a.VersionId })
            .FirstOrDefaultAsync(ct);
        if (analysis is null) return Results.NotFound();
        if (analysis.VersionId is null)
            return Results.BadRequest(new { error = "Analysis has no song version; cannot attach a rack preset." });

        // Tier gates the coach-mix LLM arbiter's spend attribution in the worker.
        EntitlementsDto entitlements;
        try
        {
            entitlements = await ents.ForAsync(userId, ct);
        }
        catch (Exception)
        {
            return ErrorEnvelope.Build(503, "entitlements_unavailable",
                "Entitlement service temporarily unavailable.");
        }
        var tier = entitlements.Tier; // "pro" | "credits" | "free"

        await queue.EnqueueAsync(
            DramatiqTasks.GenerateFixRack,
            new object[] { analysis.Id.ToString(), userId.ToString(), tier },
            DramatiqQueues.AnalysisPaid, // story 2.5: secondary op → W1
            ct);

        return Results.Accepted(value: new { status = "queued" });
    }

    // GET /api/reports/{jobId}/fix-rack — the generated analysis preset, or 204.
    private static async Task<IResult> GetFixRack(
        Guid jobId, ClaimsPrincipal user, AppDbContext db, CancellationToken ct)
    {
        var userId = user.UserId();
        var analysis = await db.Analyses.AsNoTracking()
            .Where(a => a.JobId == jobId && a.UserId == userId)
            .Select(a => new { a.VersionId })
            .FirstOrDefaultAsync(ct);
        if (analysis is null) return Results.NotFound();
        if (analysis.VersionId is null) return Results.NoContent();

        var preset = await db.RackPresets.AsNoTracking()
            .Where(p => p.SongVersionId == analysis.VersionId.Value && p.Source == "analysis")
            .OrderByDescending(p => p.CreatedAt)
            .Select(p => new { p.Id, p.Name, p.ChainJson, p.CoachMeta, p.CreatedAt })
            .FirstOrDefaultAsync(ct);
        if (preset is null) return Results.NoContent();

        JsonElement chain;
        try
        {
            using var doc = JsonDocument.Parse(preset.ChainJson);
            chain = doc.RootElement.Clone();
        }
        catch (JsonException)
        {
            return Results.NoContent();
        }

        JsonElement? coachMeta = null;
        if (!string.IsNullOrEmpty(preset.CoachMeta))
        {
            try
            {
                using var cm = JsonDocument.Parse(preset.CoachMeta);
                coachMeta = cm.RootElement.Clone();
            }
            catch (JsonException) { coachMeta = null; }
        }

        // Story 12.4: PresetId is the Listen carry-over handle — the panel's
        // "Open in Listen rack" passes it as ?fixPreset= and the Listen page
        // fetches the chain back via GET /versions/{v}/rack/presets/{id}.
        return Results.Ok(new FixRackDto(preset.Id, preset.Name, chain, coachMeta, preset.CreatedAt));
    }
}
