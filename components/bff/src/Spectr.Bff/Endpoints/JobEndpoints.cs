using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using System.Security.Claims;
using System.Text;
using System.Text.Json;

namespace Spectr.Bff.Endpoints;

public static class JobEndpoints
{
    public static IEndpointRouteBuilder MapJobEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/jobs").WithTags("jobs").RequireAuthorization();

        g.MapGet("/", List);
        g.MapGet("/{jobId:guid}", GetStatus);
        g.MapGet("/{jobId:guid}/stream", StreamStatus);
        g.MapGet("/{jobId:guid}/results", GetResults);
        g.MapGet("/{jobId:guid}/images/{kind}", GetImage);
        g.MapPost("/{jobId:guid}/retry", RetryFree);

        return app;
    }

    public sealed record RetryResponse(Guid JobId);

    // POST /api/jobs/{jobId}/retry — Story 5.7 (FR6/AR16) free retry.
    //
    // A failed job (≠ invalid_file) or a complete-but-degraded analysis
    // (≥1 failed phase in final_json.phases[]) earns ONE entitlement-free
    // re-analysis of the same version. Eligibility is 100% server-derived —
    // no client-supplied "it failed" flag — and the free chain is capped at 1
    // (a retry job is never itself free-retry eligible). Authed users only:
    // device-owned anon jobs 404 here (the anon funnel has its own rules).
    private static async Task<IResult> RetryFree(
        Guid jobId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        EntitlementService ents,
        CreditLedgerService credits,
        IJobQueue queue,
        HttpContext httpCtx,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var origin = await db.AnalysisJobs.AsNoTracking()
            .Where(j => j.Id == jobId && j.UserId == userId)
            .Select(j => new { j.Status, j.ErrorCode, j.VersionId, j.ReferenceId, j.RetryOfJobId })
            .FirstOrDefaultAsync(ct);
        if (origin is null) return Results.NotFound();

        // Chain cap: one free retry per PAID analysis — a retry job never
        // spawns another free retry, whatever happened to it.
        if (origin.RetryOfJobId is not null)
            return ErrorEnvelope.Build(409, "retry_not_eligible",
                "This analysis was already a free retry.");

        // Same-version re-run is the whole contract (AC2); song-less jobs
        // (anon-claimed file_path jobs without a version) can't re-dispatch.
        if (origin.VersionId is not Guid versionId)
            return ErrorEnvelope.Build(409, "retry_not_eligible",
                "This analysis has no song version to re-run.");

        var eligible = origin.Status switch
        {
            // invalid_file: already compensated by the AR16 reversal path,
            // and a byte-identical retry fails identically — re-export first.
            "failed" => !string.Equals(origin.ErrorCode, "invalid_file", StringComparison.Ordinal),
            // complete: degraded only — ≥1 failed phase in the stored report.
            "complete" => await HasFailedPhaseAsync(db, jobId, ct),
            _ => false, // pending/processing/awaiting_stem_mapping: nothing to retry yet
        };
        if (!eligible)
            return ErrorEnvelope.Build(409, "retry_not_eligible",
                "This analysis completed cleanly — retry isn't free.");

        // Review finding: only origins that actually CONSUMED entitlement earn
        // the free re-run. The lightweight rerun-phase tracking jobs (and any
        // other non-consuming dispatch) carry a user+version but no usage
        // event / credit spend — without this guard each failed rerun would
        // mint a fresh entitlement-free FULL analysis, repeatably.
        var jobRef = jobId.ToString();
        var consumed =
            await db.UsageEvents.AsNoTracking()
                .AnyAsync(e => e.UserId == userId && e.Reference == jobRef, ct)
            || await db.CreditLedger.AsNoTracking()
                .AnyAsync(e => e.UserId == userId && e.Reason == "spend" && e.Reference == jobRef, ct);
        if (!consumed)
            return ErrorEnvelope.Build(409, "retry_not_eligible",
                "Only a full analysis run can be retried free.");

        // Review finding: a retention-purged (or deleted) version dispatches
        // fine and fails in the worker — burning the once-only retry on a
        // guaranteed loss. Check the audio still exists first.
        var version = await db.SongVersions.AsNoTracking()
            .Where(v => v.Id == versionId)
            .Select(v => new { v.RawAudioPurgedAt })
            .FirstOrDefaultAsync(ct);
        if (version is null || version.RawAudioPurgedAt is not null)
            return ErrorEnvelope.Build(409, "retry_not_eligible",
                "The original audio is no longer stored — upload the file again to re-analyze.");

        // Once-only fast path (the DB's partial unique index is the authority;
        // the dispatch insert maps its violation to the same 409).
        if (await db.AnalysisJobs.AsNoTracking().AnyAsync(j => j.RetryOfJobId == jobId, ct))
            return ErrorEnvelope.Build(409, "retry_already_used",
                "The free retry for this analysis was already used.");

        // Review finding: a since-deleted reference would 404 the whole retry
        // forever — drop it and retry the mix alone instead.
        var referenceId = origin.ReferenceId;
        if (referenceId is Guid refId
            && !await db.ReferenceTracks.AsNoTracking()
                .AnyAsync(r => r.Id == refId && r.UserId == userId, ct))
            referenceId = null;

        var (newJobId, error) = await VersionEndpoints.DispatchAnalysisAsync(
            userId, versionId, referenceId,
            db, ents, credits, queue, httpCtx, ct,
            freeRetry: true, retryOfJobId: jobId);
        if (error is not null) return error;

        return Results.Ok(new RetryResponse(newJobId));
    }

    private static async Task<bool> HasFailedPhaseAsync(AppDbContext db, Guid jobId, CancellationToken ct)
    {
        var finalJson = await db.Analyses.AsNoTracking()
            .Where(a => a.JobId == jobId)
            .Select(a => a.FinalJson)
            .FirstOrDefaultAsync(ct);
        if (string.IsNullOrEmpty(finalJson)) return false;
        try
        {
            using var doc = JsonDocument.Parse(finalJson);
            if (!doc.RootElement.TryGetProperty("phases", out var phases)
                || phases.ValueKind != JsonValueKind.Array)
                return false;
            foreach (var p in phases.EnumerateArray())
            {
                if (p.ValueKind == JsonValueKind.Object
                    && p.TryGetProperty("status", out var s)
                    && s.ValueKind == JsonValueKind.String
                    && s.GetString() == "failed")
                    return true;
            }
            return false;
        }
        catch (JsonException)
        {
            return false; // corrupt stored JSON — not eligible, don't 500
        }
    }

    // GET /api/jobs?status=pending,processing&limit=50
    private static async Task<IResult> List(
        [FromQuery] string? status,
        [FromQuery] int? limit,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var take = Math.Clamp(limit ?? 50, 1, 200);
        var statusFilter = string.IsNullOrEmpty(status)
            ? null
            : status.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var query =
            from j in db.AnalysisJobs.AsNoTracking()
            where j.UserId == userId
            join v in db.SongVersions.AsNoTracking() on j.VersionId equals v.Id into vj
            from v in vj.DefaultIfEmpty()
            join s in db.Songs.AsNoTracking() on v.SongId equals s.Id into sj
            from s in sj.DefaultIfEmpty()
            orderby j.DispatchedAt descending
            select new
            {
                j.Id,
                j.Status,
                j.CurrentPhase,
                j.PhasePct,
                j.VersionId,
                SongId = (Guid?)(v != null ? v.SongId : Guid.Empty),
                SongName = s != null ? s.Name : null,
                j.DispatchedAt,
                j.StartedAt,
                j.CompletedAt,
                j.FailedAt,
            };

        var rows = await query.Take(take * 2).ToListAsync(ct);
        var filtered = statusFilter is null
            ? rows
            : rows.Where(r => statusFilter.Contains(r.Status)).ToList();
        var page = filtered.Take(take).Select(r => new JobSummaryDto(
            r.Id, r.Status, r.CurrentPhase, r.PhasePct, r.VersionId,
            r.SongId == Guid.Empty ? null : r.SongId,
            r.SongName,
            r.DispatchedAt, r.StartedAt, r.CompletedAt, r.FailedAt)).ToList();
        return Results.Ok(page);
    }

    // GET /api/jobs/{id}/stream  (SSE)
    //
    // Polls the DB every 1.5s and emits one `event: status` per change.
    // We don't have a pub/sub mechanism between the worker and the BFF yet —
    // when that lands, swap the poll loop for a Redis pubsub or PG NOTIFY
    // listener. Until then this is honest server-side polling that lets
    // clients consume a single long-lived connection.
    private static async Task StreamStatus(
        Guid jobId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        HttpContext httpCtx,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var owned = await db.AnalysisJobs.AsNoTracking()
            .AnyAsync(j => j.Id == jobId && j.UserId == userId, ct);
        if (!owned)
        {
            httpCtx.Response.StatusCode = 404;
            return;
        }

        httpCtx.Response.Headers["Content-Type"] = "text/event-stream";
        httpCtx.Response.Headers["Cache-Control"] = "no-cache";
        httpCtx.Response.Headers["X-Accel-Buffering"] = "no";  // disable nginx buffering

        string? lastSerialized = null;
        var pollDelay = TimeSpan.FromMilliseconds(1500);

        while (!ct.IsCancellationRequested)
        {
            var snapshot = await db.AnalysisJobs.AsNoTracking()
                .Where(j => j.Id == jobId && j.UserId == userId)
                .Select(j => new
                {
                    j.Status,
                    j.CurrentPhase,
                    j.PhasePct,
                    j.ErrorMessage,
                    j.StartedAt,
                    j.CompletedAt,
                    j.FailedAt,
                })
                .FirstOrDefaultAsync(ct);
            if (snapshot is null) break;

            var serialized = JsonSerializer.Serialize(snapshot);
            if (serialized != lastSerialized)
            {
                var bytes = Encoding.UTF8.GetBytes($"event: status\ndata: {serialized}\n\n");
                await httpCtx.Response.Body.WriteAsync(bytes, ct);
                await httpCtx.Response.Body.FlushAsync(ct);
                lastSerialized = serialized;
            }
            // Stop the stream cleanly once the job reaches a terminal state.
            if (snapshot.Status == "complete" || snapshot.Status == "failed") break;
            try { await Task.Delay(pollDelay, ct); }
            catch (TaskCanceledException) { break; }
        }
    }

    private static async Task<IResult> GetStatus(
        Guid jobId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CreditLedgerService credits,
        ILogger<JobStatusReversal> logger,
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
                j.ErrorCode,
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

        // Story 2.3 / AC3 — lazy credit reversal on read. If the worker
        // failed pre-pipeline with a typed `invalid_file` error AND a
        // prior credit spend exists for this job (i.e. the user paid
        // with credits), refund the credit. The partial unique index
        // on `idempotency_key = "reversal:<jobId>"` makes this safe to
        // call repeatedly — duplicate reads are no-ops.
        //
        // Per AR13, the worker never reads/writes billing tables. This
        // read-path observer keeps that separation: the worker writes
        // a typed error code; the BFF observes it on the next read and
        // issues the reversal. Story 2.10 reconciliation is the
        // backstop for failed jobs the user never re-opens.
        if (row.Status == "failed"
            && string.Equals(row.ErrorCode, "invalid_file", StringComparison.Ordinal))
        {
            var hasSpend = await db.CreditLedger.AsNoTracking()
                .AnyAsync(e => e.UserId == userId
                    && e.Reason == "spend"
                    && e.Reference == jobId.ToString(), ct);
            if (hasSpend)
            {
                var entry = await credits.ReverseAsync(
                    userId, jobId, "invalid_file", ct);
                if (entry is not null)
                {
                    logger.LogInformation(
                        "Refunded credit for invalid-file failure: user={UserId}, jobId={JobId}",
                        userId, jobId);
                }
            }
        }

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

    // Story 2.3 — concrete marker for ILogger<T> category. Surfaces as
    // `Spectr.Bff.Endpoints.JobStatusReversal` in log filters.
    public sealed class JobStatusReversal { }

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
                a.SpectrogramImagePath,
                a.WaveformImagePath,
            })
            .FirstOrDefaultAsync(ct);
        if (row is null) return Results.NotFound();

        using var doc = JsonDocument.Parse(row.FinalJson);
        var finalJson = doc.RootElement.Clone();

        // Stored "project awareness" map (client-parsed .als), surfaced for the
        // results Project view. Looked up off the analysis's version.
        JsonElement? alsProject = null;
        if (row.VersionId is Guid vId)
        {
            var projectRaw = await db.SongVersions.AsNoTracking()
                .Where(v => v.Id == vId)
                .Select(v => v.AlsProjectJson)
                .FirstOrDefaultAsync(ct);
            if (!string.IsNullOrEmpty(projectRaw))
            {
                try
                {
                    using var projDoc = JsonDocument.Parse(projectRaw);
                    alsProject = projDoc.RootElement.Clone();
                }
                catch (JsonException) { /* corrupt stored JSON — omit, don't 500 */ }
            }
        }

        // Image URLs (no token — the client appends ?t= for the <img> tag).
        // Only surfaced when the worker actually produced the image.
        var specUrl = row.SpectrogramImagePath is null
            ? null : $"/api/jobs/{jobId}/images/spectrogram";
        var waveUrl = row.WaveformImagePath is null
            ? null : $"/api/jobs/{jobId}/images/waveform";

        return Results.Ok(new JobResultsDto(
            row.JobId,
            row.Id,
            row.VersionId,
            row.SongId,
            row.SongName,
            finalJson,
            alsProject,
            specUrl,
            waveUrl));
    }

    // GET /api/jobs/{jobId}/images/{kind}  (kind = spectrogram | waveform)
    // Streams a server-rendered result image. Accepts auth via header OR ?t=<jwt>
    // (an <img> tag can't set headers). Owner-scoped; immutable per analysis.
    private static async Task<IResult> GetImage(
        Guid jobId,
        string kind,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IFileStorage storage,
        IMultipartObjectStore objectStore,
        HttpResponse response,
        CancellationToken ct)
    {
        if (kind is not ("spectrogram" or "waveform")) return Results.BadRequest();

        var userId = currentUser.UserId();
        var key = await db.Analyses.AsNoTracking()
            .Where(a => a.JobId == jobId && a.UserId == userId)
            .Select(a => kind == "spectrogram" ? a.SpectrogramImagePath : a.WaveformImagePath)
            .FirstOrDefaultAsync(ct);
        if (string.IsNullOrEmpty(key)) return Results.NotFound();

        // Content is immutable for a given analysis — the LOCAL-proxy branch
        // may cache hard; MediaDelivery sets the header from the same existence
        // check that picks the branch (a separate check here could race a
        // deletion and immutable-cache an expiring 302 for a year).
        return await MediaDelivery.ServeAsync(
            storage, objectStore, key, "image/webp", response, ct,
            rangeProcessing: false, immutableCacheOnLocal: true);
    }
}
