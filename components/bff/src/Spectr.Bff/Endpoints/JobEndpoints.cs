using Spectr.Bff.Infrastructure;

using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Data;
using System.Security.Claims;
using System.Text.Json;

namespace Spectr.Bff.Endpoints;

public static class JobEndpoints
{
    public static IEndpointRouteBuilder MapJobEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/jobs").WithTags("jobs").RequireAuthorization();

        // Slice 1: status + results only. List + SSE are later slices.
        g.MapGet("/", () => NotImplementedResult.Stub());
        g.MapGet("/{jobId:guid}", GetStatus);
        g.MapGet("/{jobId:guid}/stream", (Guid jobId) => NotImplementedResult.Stub());
        g.MapGet("/{jobId:guid}/results", GetResults);

        return app;
    }

    private static async Task<IResult> GetStatus(
        Guid jobId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var row = await (
            from j in db.AnalysisJobs.AsNoTracking()
            where j.Id == jobId && j.UserId == userId
            select new
            {
                j.Id,
                j.Status,
                j.CurrentPhase,
                j.PhasePct,
                j.VersionId,
                j.ErrorMessage,
                j.DispatchedAt,
                j.StartedAt,
                j.CompletedAt,
                j.FailedAt,
                SongId = (Guid?)db.SongVersions
                    .Where(v => v.Id == j.VersionId)
                    .Select(v => (Guid?)v.SongId)
                    .FirstOrDefault(),
            }
        ).FirstOrDefaultAsync(ct);
        if (row is null) return Results.NotFound();

        return Results.Ok(new JobStatusDto(
            row.Id,
            row.Status,
            row.CurrentPhase,
            row.PhasePct,
            row.VersionId,
            row.SongId,
            row.ErrorMessage,
            row.DispatchedAt,
            row.StartedAt,
            row.CompletedAt,
            row.FailedAt));
    }

    private static async Task<IResult> GetResults(
        Guid jobId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var row = await db.Analyses.AsNoTracking()
            .Where(a => a.JobId == jobId && a.UserId == userId)
            .Select(a => new
            {
                a.Id,
                a.JobId,
                a.VersionId,
                a.SongId,
                a.SongName,
                a.FinalJson,
                a.ShareToken,
            })
            .FirstOrDefaultAsync(ct);
        if (row is null) return Results.NotFound();

        using var doc = JsonDocument.Parse(row.FinalJson);
        var finalJson = doc.RootElement.Clone();

        return Results.Ok(new JobResultsDto(
            row.JobId,
            row.Id,
            row.VersionId,
            row.SongId,
            row.SongName,
            finalJson,
            row.ShareToken));
    }
}
