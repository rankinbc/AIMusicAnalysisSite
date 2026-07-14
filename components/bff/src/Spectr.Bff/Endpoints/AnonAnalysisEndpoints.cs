using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Text.Json;

namespace Spectr.Bff.Endpoints;

// Story 6.3 (FR7/AR26) — the anonymous instant-analysis vertical. A visitor
// with no account uploads one track under a device identity (the 4.5
// spectr_device HMAC cookie, minted here on first upload) and gets a REAL
// analysis: song-less, version-less AnalysisJob { DeviceId, FilePath } rows
// (DB CHECK enforces user XOR device ownership).
//
// Deliberately parallel to — never entangled with — the authed vertical:
// no entitlements, no UsageEvents, no verify gate, no credits. Abuse arms:
// one ACTIVE analysis per device, and the SAME limiter actions as the authed
// free tier ("uploads_init", "analysis_dispatch") with a device:{id} actor
// arm — the IP arms therefore POOL across anon + free (IRateLimiter doc:
// for anon the IP arm is the real ceiling; device ids are cheap to rotate).
//
// The claim path is NOT here: registration re-parents device rows
// automatically when the cookie rides the register POST (AuthEndpoints, 4.5).
public static class AnonAnalysisEndpoints
{
    private const long MaxUploadBytes = 250L * 1024 * 1024;

    public static IEndpointRouteBuilder MapAnonAnalysisEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/anon").WithTags("anon-analysis").AllowAnonymous();
        g.MapPost("/analyses", Upload)
            .WithMetadata(new RequestSizeLimitAttribute(MaxUploadBytes))
            .DisableAntiforgery();
        g.MapGet("/jobs/current", GetCurrent);
        g.MapGet("/jobs/{jobId:guid}", GetStatus);
        g.MapGet("/jobs/{jobId:guid}/results", GetResults);
        return g;
    }

    // ── POST /api/anon/analyses — multipart proxy upload + dispatch ──────────
    private static async Task<IResult> Upload(
        [FromForm] IFormFile file,
        HttpContext httpCtx,
        AppDbContext db,
        IFileStorage storage,
        IJobQueue queue,
        DeviceService devices,
        IRateLimiter limiter,
        IConfiguration cfg,
        EntitlementService ents,
        CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            return ErrorEnvelope.Build(400, "invalid_file", "Empty file.");
        if (file.Length > MaxUploadBytes)
            return ErrorEnvelope.Build(400, "invalid_file", "File exceeds the 250 MB limit.");
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (ext is not (".wav" or ".flac" or ".mp3" or ".aiff" or ".aif" or ".m4a" or ".ogg"))
            return ErrorEnvelope.Build(400, "invalid_file",
                "That doesn't look like an audio file — WAV, FLAC or MP3 work best.");
        // Magic-byte sniff (CLAUDE.md rule: never trust extension/Content-Type
        // on an upload — doubly so on an UNAUTHENTICATED surface). Rejects a
        // 250 MB `evil.wav` of junk before it reaches storage + the worker.
        await using (var probe = file.OpenReadStream())
        {
            if (!await LooksLikeAudioAsync(probe, ct))
                return ErrorEnvelope.Build(400, "invalid_file",
                    "That file isn't a recognized audio format (WAV, FLAC, MP3, AIFF, M4A or OGG).");
        }

        var device = await devices.GetOrCreateAsync(httpCtx);

        // AR26: one ACTIVE analysis per device — honest copy, no silent queueing.
        if (await devices.HasActiveAnalysisAsync(device.Id, ct))
            return ErrorEnvelope.Build(409, "anon_active_analysis",
                "One analysis at a time — this device's previous one is still running.");

        var limitsOn = !string.Equals(cfg["RateLimits:Enabled"], "false", StringComparison.OrdinalIgnoreCase);
        var ip = VersionEndpoints.NormalizeIpForLimiting(httpCtx.Connection.RemoteIpAddress);
        if (limitsOn && ip is not null)
        {
            try
            {
                // Same actions as the authed free tier so the IP arms pool.
                var burst = await limiter.CheckAsync(
                    $"device:{device.Id}", ip, "uploads_init", 10, TimeSpan.FromMinutes(1), ct);
                if (!burst.Allowed)
                    return ErrorEnvelope.Build(429, "rate_limited",
                        "Too many uploads — give it a minute.");

                var flags = await ents.GetFlagsAsync(ct);
                var perIp = flags.TryGetValue("dispatch_per_ip_hourly", out var pv)
                    && int.TryParse(pv, out var pn) && pn > 0 ? pn : 10;
                var hourly = await limiter.CheckAsync(
                    $"device:{device.Id}", ip, "analysis_dispatch", perIp, TimeSpan.FromHours(1), ct);
                if (!hourly.Allowed)
                    return ErrorEnvelope.Build(429, "rate_limited",
                        "Too many analyses from this network — create an account for more.");
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception) { /* fail-open — throttling layer only (10.6 policy) */ }
        }

        var jobId = Guid.NewGuid();
        var key = $"audio/anon/{device.Id}/{jobId}/source{ext}";
        await using (var src = file.OpenReadStream())
        {
            // Server-derived content type — never persist the client's (a
            // spoofed text/html could bite when the object is served same-origin
            // after claim). audio/* is correct for everything we accept here.
            await storage.WriteAsync(key, src, "audio/" + ext.TrimStart('.'), ct);
        }

        // Song-less, version-less job; the worker resolves audio from FilePath.
        db.AnalysisJobs.Add(new AnalysisJob
        {
            Id = jobId,
            DeviceId = device.Id,
            UserId = null,
            VersionId = null,
            FilePath = key,
            Tier = "free",
            Status = "pending",
        });
        await db.SaveChangesAsync(ct);

        try
        {
            await queue.EnqueueAsync(
                DramatiqTasks.AnalyzeAudioJob,
                new object[] { jobId.ToString() },
                DramatiqQueues.AnalysisFree,
                ct);
        }
        catch (Exception)
        {
            // 3.5 policy: a committed row with no message must fail loud now,
            // not sit out the pending grace.
            var row = await db.AnalysisJobs.FirstOrDefaultAsync(j => j.Id == jobId, ct);
            if (row is not null)
            {
                row.Status = "failed";
                row.ErrorCode = "dispatch_failed";
                row.ErrorMessage = "Could not queue the analysis. Try again.";
                row.CurrentPhase = "failed";
                row.FailedAt = DateTimeOffset.UtcNow;
                await db.SaveChangesAsync(ct);
            }
            throw;
        }

        return Results.Ok(new AnonAnalysisResponse(jobId));
    }

    // Magic-byte sniff for the formats the anon zone accepts. Content-Type and
    // extension are both spoofable; these header signatures are not. Falls back
    // to true only when the stream can't be peeked (never on an IFormFile).
    private static async Task<bool> LooksLikeAudioAsync(Stream s, CancellationToken ct)
    {
        if (!s.CanSeek) return true;
        var buf = new byte[12];
        var n = await s.ReadAsync(buf.AsMemory(0, 12), ct);
        s.Position = 0;
        if (n < 4) return false;
        bool Eq(int off, string sig) =>
            n >= off + sig.Length && sig.Select((c, i) => (byte)c == buf[off + i]).All(x => x);
        return Eq(0, "RIFF")                        // wav
            || Eq(0, "fLaC")                        // flac
            || Eq(0, "ID3")                         // mp3 w/ ID3 tag
            || (n >= 2 && buf[0] == 0xFF && (buf[1] & 0xE0) == 0xE0) // mp3 frame sync
            || Eq(0, "FORM")                        // aiff (FORM....AIFF)
            || Eq(0, "OggS")                        // ogg
            || Eq(4, "ftyp");                       // m4a/mp4 (box at offset 4)
    }

    // ── GET /api/anon/jobs/current — AC5 refresh restore + 6.4 resume card ────
    // Returns the device's latest job with enough to (a) restore on /analyze
    // (jobId) and (b) render the landing resume card (status + when + grade).
    // Grade is only present once a completed Analysis exists for the job.
    private static async Task<IResult> GetCurrent(
        HttpContext httpCtx, AppDbContext db, DeviceService devices, CancellationToken ct)
    {
        var deviceId = devices.ReadDeviceId(httpCtx.Request);
        if (deviceId is null) return Results.NotFound();
        var row = await db.AnalysisJobs.AsNoTracking()
            .Where(j => j.DeviceId == deviceId)
            .OrderByDescending(j => j.DispatchedAt)
            .Select(j => new { j.Id, j.Status, j.DispatchedAt })
            .FirstOrDefaultAsync(ct);
        if (row is null) return Results.NotFound();

        // Grade for the card chip — only when a completed Analysis exists (one
        // small row on an infrequent resume fetch). Null while pending/failed.
        string? gradeValue = null;
        if (row.Status == "complete")
        {
            var finalJson = await db.Analyses.AsNoTracking()
                .Where(a => a.JobId == row.Id && a.DeviceId == deviceId)
                .Select(a => a.FinalJson)
                .FirstOrDefaultAsync(ct);
            if (!string.IsNullOrEmpty(finalJson))
            {
                try
                {
                    using var doc = JsonDocument.Parse(finalJson);
                    if (doc.RootElement.TryGetProperty("grade", out var g) && g.ValueKind == JsonValueKind.String)
                        gradeValue = g.GetString();
                }
                catch (JsonException) { /* corrupt payload — no grade chip */ }
            }
        }

        return Results.Ok(new AnonResumeDto(row.Id, row.Status, row.DispatchedAt, gradeValue));
    }

    // ── GET /api/anon/jobs/{id} — device-scoped status (JobEndpoints fork) ───
    private static async Task<IResult> GetStatus(
        Guid jobId, HttpContext httpCtx, AppDbContext db, DeviceService devices, CancellationToken ct)
    {
        var deviceId = devices.ReadDeviceId(httpCtx.Request);
        if (deviceId is null) return Results.NotFound();
        var row = await db.AnalysisJobs.AsNoTracking()
            .Where(j => j.Id == jobId && j.DeviceId == deviceId)
            .Select(j => new
            {
                j.Id, j.Status, j.CurrentPhase, j.PhasePct, j.ErrorMessage,
                j.DispatchedAt, j.StartedAt, j.CompletedAt, j.FailedAt,
            })
            .FirstOrDefaultAsync(ct);
        if (row is null) return Results.NotFound();
        return Results.Ok(new JobStatusDto(
            row.Id, row.Status, row.CurrentPhase, row.PhasePct,
            null, null, row.ErrorMessage,
            row.DispatchedAt, row.StartedAt, row.CompletedAt, row.FailedAt));
    }

    // ── GET /api/anon/jobs/{id}/results — device-scoped, REDUCED projection ──
    // Review CRITICAL: a client-side BlurLock is cosmetic — the account gate is
    // only real if the withheld findings never leave the server. The anon
    // surface returns ONLY what UX-DR27 shows unlocked (grade/score, phase-1 for
    // streaming readiness, the #1 finding) plus a COUNT of the rest. The full
    // report is served exclusively by the authed /jobs/{id}/results after claim.
    private static async Task<IResult> GetResults(
        Guid jobId, HttpContext httpCtx, AppDbContext db, DeviceService devices, CancellationToken ct)
    {
        var deviceId = devices.ReadDeviceId(httpCtx.Request);
        if (deviceId is null) return Results.NotFound();
        var raw = await db.Analyses.AsNoTracking()
            .Where(a => a.JobId == jobId && a.DeviceId == deviceId)
            .Select(a => a.FinalJson)
            .FirstOrDefaultAsync(ct);
        if (raw is null) return Results.NotFound();

        JsonElement full;
        try
        {
            using var doc = JsonDocument.Parse(string.IsNullOrEmpty(raw) ? "{}" : raw);
            full = doc.RootElement.Clone();
        }
        catch (JsonException)
        {
            // A malformed/partial-failure payload must not 500 the funnel.
            return Results.Ok(AnonReportProjection.Empty(jobId));
        }

        return Results.Ok(AnonReportProjection.Build(jobId, full));
    }
}
