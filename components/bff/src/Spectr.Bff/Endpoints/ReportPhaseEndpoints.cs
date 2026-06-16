using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Security.Claims;

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
        CancellationToken ct)
    {
        // Phase 1 is the only phase every other phase depends on → it's a full
        // re-analyze, not an in-place single-phase re-run. The UI gates which
        // buttons appear (4/5/8 + retry-failed); the server just enforces the range.
        if (phase < 2 || phase > 8)
            return Results.BadRequest(new { error = "Phase must be 2–8. Phase 1 is a full re-analyze." });

        var userId = currentUser.UserId();
        var analysis = await db.Analyses.AsNoTracking()
            .Where(a => a.JobId == jobId && a.UserId == userId)
            .Select(a => new { a.Id, a.VersionId })
            .FirstOrDefaultAsync(ct);
        if (analysis is null) return Results.NotFound();

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
            new object[] { rerunJobId.ToString(), analysis.Id.ToString(), phase.ToString() },
            ct);

        return Results.Accepted(value: new RerunPhaseResponse(rerunJobId));
    }
}
