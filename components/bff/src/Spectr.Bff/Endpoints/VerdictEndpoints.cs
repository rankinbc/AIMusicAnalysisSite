using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Infrastructure;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Security.Claims;
using System.Text.Json;

namespace Spectr.Bff.Endpoints;

public static class VerdictEndpoints
{
    public static IEndpointRouteBuilder MapVerdictEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/reports/{jobId:guid}/verdicts").WithTags("verdicts").RequireAuthorization();
        g.MapGet("/", ListVerdicts);
        g.MapPost("/run/{specialist}", RunSpecialist);
        g.MapGet("/stream", (Guid jobId) => NotImplementedResult.Stub());  // SSE — slice 2.6

        var per = app.MapGroup("/verdicts/{verdictId}").WithTags("verdicts").RequireAuthorization();
        per.MapPost("/dismiss", (string verdictId, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
            UpsertUserState(verdictId, user, db, ct, set: s => s.Dismissed = true));
        per.MapPost("/applied", (string verdictId, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
            UpsertUserState(verdictId, user, db, ct, set: s => s.Applied = true));
        per.MapPost("/feedback", SubmitFeedback);

        return app;
    }

    // GET /api/reports/{jobId}/verdicts/
    private static async Task<IResult> ListVerdicts(
        Guid jobId,
        ClaimsPrincipal user,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = user.UserId();

        // Resolve analysis by job, enforcing ownership.
        var analysisId = await db.Analyses.AsNoTracking()
            .Where(a => a.JobId == jobId && a.UserId == userId)
            .Select(a => (Guid?)a.Id)
            .FirstOrDefaultAsync(ct);
        if (analysisId is null) return Results.NotFound();

        // LEFT JOIN verdict_user_state on (verdict_id, current_user_id).
        var rows = await (
            from v in db.Verdicts.AsNoTracking()
            where v.AnalysisId == analysisId.Value
            join us in db.VerdictUserStates.AsNoTracking()
                on new { vid = v.Id, uid = userId }
                equals new { vid = us.VerdictId, uid = us.UserId } into gj
            from us in gj.DefaultIfEmpty()
            select new { Verdict = v, State = us }
        ).ToListAsync(ct);

        var verdictDtos = rows
            .OrderByDescending(r => r.Verdict.PriorityScore)
            .Select(r => ToDto(r.Verdict, r.State))
            .ToList();

        var slugsWithVerdict = rows.Select(r => r.Verdict.Specialist).ToHashSet(StringComparer.Ordinal);
        // A fail-marker verdict is recognizable by headline "Specialist failed"
        // (set by the Python actor on exception).
        var failedSlugs = rows
            .Where(r => r.Verdict.Headline == "Specialist failed")
            .Select(r => r.Verdict.Specialist)
            .ToHashSet(StringComparer.Ordinal);

        var statuses = SpecialistCatalog.Slugs
            .Select(slug => new SpecialistStatus(
                slug,
                failedSlugs.Contains(slug) ? "failed"
                    : slugsWithVerdict.Contains(slug) ? "cached"
                    : "idle"))
            .ToList();

        return Results.Ok(new VerdictsListResponse(verdictDtos, statuses));
    }

    // POST /api/reports/{jobId}/verdicts/run/{specialist}
    private static async Task<IResult> RunSpecialist(
        Guid jobId,
        string specialist,
        ClaimsPrincipal user,
        AppDbContext db,
        IJobQueue queue,
        CancellationToken ct)
    {
        if (!SpecialistCatalog.SlugSet.Contains(specialist))
            return Results.BadRequest(new { error = "Unknown specialist slug." });

        var userId = user.UserId();

        var analysis = await db.Analyses.AsNoTracking()
            .Where(a => a.JobId == jobId && a.UserId == userId)
            .Select(a => new { a.Id })
            .FirstOrDefaultAsync(ct);
        if (analysis is null) return Results.NotFound();

        var exists = await db.Verdicts.AsNoTracking()
            .AnyAsync(v => v.AnalysisId == analysis.Id && v.Specialist == specialist, ct);
        if (exists)
            return Results.Conflict(new { error = "Specialist already has a verdict for this analysis. Dismiss it first to re-run.", status = "exists" });

        await queue.EnqueueAsync(
            DramatiqTasks.RunSpecialist,
            new object[] { analysis.Id.ToString(), specialist, userId.ToString() },
            ct);

        return Results.Accepted(value: new RunSpecialistResponse("queued"));
    }

    // POST /api/verdicts/{verdictId}/feedback
    private static async Task<IResult> SubmitFeedback(
        string verdictId,
        FeedbackRequest req,
        ClaimsPrincipal user,
        AppDbContext db,
        CancellationToken ct)
    {
        if (req.Feedback is not ("helpful" or "wrong" or "unclear"))
            return Results.BadRequest(new { error = "feedback must be one of: helpful, wrong, unclear" });
        return await UpsertUserState(verdictId, user, db, ct, set: s => s.Feedback = req.Feedback);
    }

    // ── Upsert helper for the three state-mutation endpoints. ────────────────
    private static async Task<IResult> UpsertUserState(
        string verdictId,
        ClaimsPrincipal user,
        AppDbContext db,
        CancellationToken ct,
        Action<VerdictUserState> set)
    {
        var userId = user.UserId();

        // Enforce ownership: the verdict's analysis must belong to this user.
        var owned = await (
            from v in db.Verdicts.AsNoTracking()
            join a in db.Analyses.AsNoTracking() on v.AnalysisId equals a.Id
            where v.Id == verdictId && a.UserId == userId
            select v.Id
        ).AnyAsync(ct);
        if (!owned) return Results.NotFound();

        var row = await db.VerdictUserStates
            .FirstOrDefaultAsync(s => s.VerdictId == verdictId && s.UserId == userId, ct);

        if (row is null)
        {
            row = new VerdictUserState
            {
                VerdictId = verdictId,
                UserId = userId,
            };
            db.VerdictUserStates.Add(row);
        }
        set(row);
        row.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    // ── DTO mapper ───────────────────────────────────────────────────────────
    private static VerdictDto ToDto(Verdict v, VerdictUserState? state)
    {
        var us = new VerdictUserStateDto(
            Dismissed: state?.Dismissed ?? false,
            Applied: state?.Applied ?? false,
            Feedback: state?.Feedback);

        return new VerdictDto(
            Id: v.Id,
            AnalysisId: v.AnalysisId,
            Specialist: v.Specialist,
            PromptVersion: v.PromptVersion,
            Model: v.Model,
            Severity: v.Severity,
            Category: v.Category,
            Confidence: v.Confidence,
            PriorityScore: v.PriorityScore,
            Impact: v.Impact,
            ChartType: v.ChartType,
            Headline: v.Headline,
            Summary: v.Summary,
            Body: v.Body,
            MetricLine: v.MetricLine,
            WhyItMatters: v.WhyItMatters,
            PresetName: v.PresetName,
            Evidence: ParseJsonOrEmpty(v.Evidence),
            Fix: TryParseJson(v.Fix),
            Sources: ParseJsonOrEmpty(v.Sources),
            CreatedAt: v.CreatedAt,
            UserState: us);
    }

    private static JsonElement ParseJsonOrEmpty(string raw)
    {
        try
        {
            using var doc = JsonDocument.Parse(raw);
            return doc.RootElement.Clone();
        }
        catch (JsonException)
        {
            using var fallback = JsonDocument.Parse("[]");
            return fallback.RootElement.Clone();
        }
    }

    private static JsonElement? TryParseJson(string? raw)
    {
        if (string.IsNullOrEmpty(raw)) return null;
        try
        {
            using var doc = JsonDocument.Parse(raw);
            return doc.RootElement.Clone();
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
