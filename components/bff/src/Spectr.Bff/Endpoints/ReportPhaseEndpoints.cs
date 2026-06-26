using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Security.Claims;
using System.Text.Json.Nodes;

namespace Spectr.Bff.Endpoints;

// Per-phase re-run: re-run a single analysis phase and merge it into the existing
// report in place. Dispatches the `rerun_phase` worker actor, tracked by a
// lightweight re-run AnalysisJob (so the existing job-status/SSE infra surfaces it).
public static class ReportPhaseEndpoints
{
    public static IEndpointRouteBuilder MapReportPhaseEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/reports/{jobId:guid}/phases").WithTags("reports").RequireAuthorization();
        g.MapPost("/{phase:int}/rerun", RerunPhase);
        return app;
    }

    // POST /api/reports/{jobId}/phases/{phase}/rerun
    private static async Task<IResult> RerunPhase(
        Guid jobId,
        int phase,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IJobQueue queue,
        ReferenceProfileAggregator aggregator,
        RerunPhaseRequest? body,
        CancellationToken ct)
    {
        // Phase 1 is the only phase every other phase depends on → it's a full
        // re-analyze, not an in-place single-phase re-run. The UI gates which
        // buttons appear (4/5/8 + retry-failed); the server just enforces the range.
        if (phase < 2 || phase > 9)
            return Results.BadRequest(new { error = "Phase must be 2–9. Phase 1 is a full re-analyze." });

        var userId = currentUser.UserId();
        var analysis = await db.Analyses.AsNoTracking()
            .Where(a => a.JobId == jobId && a.UserId == userId)
            .Select(a => new { a.Id, a.VersionId })
            .FirstOrDefaultAsync(ct);
        if (analysis is null) return Results.NotFound();

        // Phase-6 reference-profile override (the in-spec profile-attach path).
        // Resolves to a job-payload value the worker passes straight to phase 6:
        //   user  → {kind,name,hue,track_count,feature_statistics}  (aggregate embedded here)
        //   genre → {kind,genre}                                    (worker loads from disk)
        //   none  → null                                            (worker uses detected genre)
        JsonNode? resolvedProfile = null;
        if (phase == 6 && body?.ReferenceProfile is { } rp)
        {
            var resolved = await ResolveProfileAsync(rp, userId, db, aggregator, ct);
            if (resolved is null)
                return Results.BadRequest(new { error = "Reference profile not found or not ready." });
            resolvedProfile = resolved;
        }

        // Lightweight re-run job — progress vehicle only. The actor updates the
        // EXISTING analysis row; it never inserts a second Analysis.
        var rerunJobId = Guid.NewGuid();
        db.AnalysisJobs.Add(new AnalysisJob
        {
            Id = rerunJobId,
            UserId = userId,
            VersionId = analysis.VersionId,
            Status = "pending",
        });
        await db.SaveChangesAsync(ct);

        await queue.EnqueueAsync(
            DramatiqTasks.RerunPhase,
            // 4th positional arg = resolved reference profile (null ⇒ worker default).
            new object[] { rerunJobId.ToString(), analysis.Id.ToString(), phase.ToString(), resolvedProfile! },
            DramatiqQueues.AnalysisPaid, // story 2.5: latency-sensitive secondary op → W1
            ct);

        return Results.Accepted(value: new RerunPhaseResponse(rerunJobId));
    }

    // Resolve an override into the worker job-payload value. Returns null when the
    // request can't be satisfied (unknown/foreign set, empty preset).
    private static async Task<JsonNode?> ResolveProfileAsync(
        ReferenceProfileRef rp,
        Guid userId,
        AppDbContext db,
        ReferenceProfileAggregator aggregator,
        CancellationToken ct)
    {
        if (string.Equals(rp.Kind, "user", StringComparison.OrdinalIgnoreCase))
        {
            if (rp.SetId is not { } setId) return null;
            var set = await db.ReferenceSets
                .FirstOrDefaultAsync(s => s.Id == setId && s.UserId == userId, ct);
            if (set is null) return null;

            var members = await db.ReferenceSetMembers.AsNoTracking()
                .Where(m => m.SetId == setId)
                .Join(db.ReferenceTracks, m => m.ReferenceId, t => t.Id, (_, t) => t)
                .ToListAsync(ct);

            // Refresh the cached aggregate before embedding so the re-run compares
            // against current member metrics.
            aggregator.EnsureFresh(set, members);
            await db.SaveChangesAsync(ct);
            if (set.ProfileJson is null) return null;

            var node = JsonNode.Parse(set.ProfileJson)!.AsObject();
            node["kind"] = "user";
            node["name"] = set.Name;
            node["hue"] = set.Hue is { } h ? (int)h : null;
            return node;
        }

        if (string.Equals(rp.Kind, "genre", StringComparison.OrdinalIgnoreCase))
        {
            var preset = rp.Preset?.Trim();
            if (string.IsNullOrEmpty(preset)) return null;
            return new JsonObject { ["kind"] = "genre", ["genre"] = preset };
        }

        return null;
    }
}
