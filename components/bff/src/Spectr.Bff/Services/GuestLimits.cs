using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Endpoints;
using Spectr.Data;
using Spectr.Data.Entities;

namespace Spectr.Bff.Services;

// Task D6 (spec D5) — the guest's own quotas, plus the global fail-closed
// hourly arm on analysis dispatch. Scoped (per-request AppDbContext).
// Task G1 (spec G-D5/G-D7) split the once-shared cap: CheckUploadAsync keys
// off `guest_uploads_max` (2), CheckAnalysisAsync off `guest_analyses_max`
// (6) — a guest may re-analyze a version more times than they uploaded
// versions. Stems and references get their own per-version/per-guest caps
// below (CheckStemsAsync / CheckReferenceAsync).
public sealed class GuestLimits(
    AppDbContext db, EntitlementService ents, IRateLimiter limiter, IConfiguration cfg, ILogger<GuestLimits> log)
{
    // Delegates to the single flag-parsing helper (GuestIdentity.Flag) so
    // every guest-flag read in the codebase agrees on missing/garbage → fallback.
    public static int Flag(Dictionary<string, string> flags, string name, int fallback)
        => GuestIdentity.Flag(flags, name, fallback);

    // Fix round 1 item 1 — guest LLM work (lazy Triage, on-demand specialists,
    // fix-rack generation) rides the free lane, whatever queue the caller's
    // tier would otherwise route to. The worker dispatches by actor_name, so
    // an actor declared on analysis-paid is consumed fine from analysis-free;
    // real users are unaffected (defaultQueue passes through unchanged).
    public static string QueueFor(ClaimsPrincipal user, string defaultQueue)
        => user.IsGuest() ? DramatiqQueues.AnalysisFree : defaultQueue;

    // Checked by the guard for `.AllowGuestUpload()` routes, BEFORE the
    // handler runs. Counts versions the guest actually uploaded — the seeded
    // demo version lives under `audio/demo/` and is excluded, so it can never
    // consume the guest's one real upload.
    //
    // Fix round 1 item 3 — the count-then-insert below is racy under N
    // parallel `POST /api/versions/` (that route carries no rate limiter of
    // its own), so N concurrent requests can all read "0 used" and all pass.
    // The atomic limiter check IN FRONT closes the race: only the first `max`
    // racing requests get past it, regardless of what the DB count reads.
    // Fails CLOSED — a limiter outage must never let an unbounded number of
    // parallel guest uploads through.
    public async Task<IResult?> CheckUploadAsync(Guid userId, CancellationToken ct)
    {
        var flags = await ents.GetFlagsAsync(ct);
        var max = Flag(flags, "guest_uploads_max", 1);

        if (!string.Equals(cfg["RateLimits:Enabled"], "false", StringComparison.OrdinalIgnoreCase))
        {
            var key = $"guest_upload:{userId}";
            try
            {
                var verdict = await limiter.CheckAsync(
                    key, key, "guest_upload", max,
                    TimeSpan.FromHours(Flag(flags, "guest_ttl_hours", 24)), ct);
                if (!verdict.Allowed)
                    return GuestGuard.Restricted("upload_limit",
                        $"A guest session includes {max} uploads — create a free account to analyze more.");
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                log.LogError(ex, "guest upload limiter unavailable — failing CLOSED");
                return DemoCapacity();
            }
        }

        var used = await db.SongVersions.CountAsync(v =>
            !v.FilePath.StartsWith("audio/demo/")
            && db.Songs.Any(s => s.Id == v.SongId && s.UserId == userId), ct);
        return used >= max
            ? GuestGuard.Restricted("upload_limit",
                $"A guest session includes {max} uploads — create a free account to analyze more.")
            : null;
    }

    // Fix round 1 item 2 — called at the top of FixRackEndpoints.Generate for
    // guests only. usage_events can't record this attempt (the CHECK
    // constraint only allows 'analysis'/'coach_message', and RackPreset has
    // no "pending" status to count against instead — controller ruling), so
    // the atomic limiter IS the enforcement, not just a race backstop.
    // Fails CLOSED like every other guest limiter check.
    public async Task<IResult?> CheckFixRackAsync(Guid userId, CancellationToken ct)
    {
        if (string.Equals(cfg["RateLimits:Enabled"], "false", StringComparison.OrdinalIgnoreCase))
            return null;

        var flags = await ents.GetFlagsAsync(ct);
        var key = $"guest_fix_rack:{userId}";
        try
        {
            var verdict = await limiter.CheckAsync(
                key, key, "guest_fix_rack",
                Flag(flags, "guest_fix_racks_max", 2),
                TimeSpan.FromHours(Flag(flags, "guest_ttl_hours", 24)), ct);
            if (!verdict.Allowed)
                return GuestGuard.Restricted("fix_rack_limit",
                    "The demo sandbox includes a couple of fix-rack generations — create a free account for more.");
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            log.LogError(ex, "guest fix-rack limiter unavailable — failing CLOSED");
            return DemoCapacity();
        }
        return null;
    }

    // Called at the top of DispatchAnalysisAsync when the caller is a guest.
    // Two independent gates: (1) the guest's OWN analysis count (append-only
    // usage_events — cannot be gamed by delete + re-upload, since deletes are
    // denied by the guard anyway), then (2) the GLOBAL guest-lane arm, which
    // FAILS CLOSED — a limiter/flag/DB failure here must never let an
    // unbounded number of guest analyses onto the single VM.
    public async Task<IResult?> CheckAnalysisAsync(Guid userId, HttpContext http, CancellationToken ct)
    {
        var flags = await ents.GetFlagsAsync(ct);
        // Task G1 — analyses are no longer 1:1 with uploads: a guest may
        // re-analyze the same version (Reanalyze, stems confirm, .als
        // attach) many times within their own analysis budget, independent
        // of how many versions they uploaded. `guest_analyses_max` (6)
        // replaces `guest_uploads_max` (2) as the source of this cap.
        var max = Flag(flags, "guest_analyses_max", 6);
        var used = await db.UsageEvents.CountAsync(
            e => e.UserId == userId && e.EventType == "analysis", ct);
        if (used >= max)
            return GuestGuard.Restricted("analysis_limit",
                $"A guest session includes {max} analyses — create a free account to analyze more.");

        var rateLimitsEnabled = !string.Equals(cfg["RateLimits:Enabled"], "false", StringComparison.OrdinalIgnoreCase);
        if (!rateLimitsEnabled) return null;

        // Fix round 1 item 4 — per-IP arm BEFORE the global arm: the global
        // "guest_analyses_per_hour" bucket has no per-IP dimension, so two
        // IPs each staying under it can still close the demo for everyone.
        // Both CheckAsync dimensions are set to the same normalised IP so
        // this is a genuinely per-IP-ONLY bucket (not pooled with any other
        // actor's bucket). Fails CLOSED like the global arm. WHY: prod IP
        // correctness depends on ForwardedHeaders__Enabled=true in
        // infra/compose.prod.yml — behind a misconfigured proxy every guest
        // shares one IP and this arm degrades to a second global cap, which
        // is still fail-safe, never fail-open.
        var ip = VersionEndpoints.NormalizeIpForLimiting(http.Connection.RemoteIpAddress);
        if (ip is not null)
        {
            try
            {
                var perIpVerdict = await limiter.CheckAsync(
                    ip, ip, "guest_analysis_ip",
                    Flag(flags, "guest_analyses_per_ip_hourly", 2), TimeSpan.FromHours(1), ct);
                if (!perIpVerdict.Allowed) return DemoCapacity();
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                log.LogError(ex, "guest per-IP analysis limiter unavailable — failing CLOSED");
                return DemoCapacity();
            }
        }

        try
        {
            var verdict = await limiter.CheckAsync(
                "guest-lane", "global", "guest_analysis",
                Flag(flags, "guest_analyses_per_hour", 10), TimeSpan.FromHours(1), ct);
            if (!verdict.Allowed) return DemoCapacity();
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            log.LogError(ex, "guest analysis limiter unavailable — failing CLOSED");
            return DemoCapacity();
        }
        return null;
    }

    // Task G1 — per-VERSION stems cap (count + total bytes), checked BEFORE
    // any bytes are written to storage. `existingFiles`/`existingBytes`
    // describe what's already staged on the version; `addFiles`/`addBytes`
    // describe the files this call would add. Fails CLOSED like every other
    // guest limiter check — a flags/DB outage must never let an unbounded
    // batch of stems through.
    public async Task<IResult?> CheckStemsAsync(
        int existingFiles, long existingBytes, int addFiles, long addBytes, CancellationToken ct)
    {
        Dictionary<string, string> flags;
        try
        {
            flags = await ents.GetFlagsAsync(ct);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            log.LogError(ex, "guest stems flags unavailable — failing CLOSED");
            return DemoCapacity();
        }

        var maxFiles = Flag(flags, "guest_stems_max_files", 12);
        var maxMb = Flag(flags, "guest_stems_max_mb", 300);
        var maxBytes = (long)maxMb * 1024 * 1024;

        if (existingFiles + addFiles > maxFiles)
            return GuestGuard.Restricted("stems_limit",
                $"A guest session includes {maxFiles} stems per version — create a free account to add more.");
        if (existingBytes + addBytes > maxBytes)
            return GuestGuard.Restricted("stems_limit",
                $"A guest session includes {maxMb} MB of stems per version — create a free account to add more.");
        return null;
    }

    // Task G1 — one reference track per guest (guest_references_max).
    // Counts ReferenceTrack rows directly (append-only from the guest's own
    // POV — the guard denies DELETE on ReferenceTrack for nobody in
    // particular today, but the count is still the right measure: a guest
    // who deletes and re-uploads does not get to keep spending the slot
    // beyond the flag's intent, since references are cheap and rarely
    // deleted in practice). Fails CLOSED on a flags/DB outage.
    public async Task<IResult?> CheckReferenceAsync(Guid userId, CancellationToken ct)
    {
        Dictionary<string, string> flags;
        try
        {
            flags = await ents.GetFlagsAsync(ct);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            log.LogError(ex, "guest reference flags unavailable — failing CLOSED");
            return DemoCapacity();
        }

        var max = Flag(flags, "guest_references_max", 1);
        int used;
        try
        {
            used = await db.ReferenceTracks.CountAsync(r => r.UserId == userId, ct);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            log.LogError(ex, "guest reference count unavailable — failing CLOSED");
            return DemoCapacity();
        }

        return used >= max
            ? GuestGuard.Restricted("reference_limit",
                $"A guest session includes {max} reference track — create a free account to add more.")
            : null;
    }

    // Fix round 1 item 2 — stems/classify enqueued on EVERY call with no
    // per-guest cap. Same shape as CheckFixRackAsync: atomic limiter, keyed
    // per guest, window = guest TTL, fails CLOSED.
    public async Task<IResult?> CheckClassifyAsync(Guid userId, CancellationToken ct)
    {
        if (string.Equals(cfg["RateLimits:Enabled"], "false", StringComparison.OrdinalIgnoreCase))
            return null;

        var flags = await ents.GetFlagsAsync(ct);
        var max = Flag(flags, "guest_classify_max", 6);
        var key = $"guest_classify:{userId}";
        try
        {
            var verdict = await limiter.CheckAsync(
                key, key, "guest_classify", max,
                TimeSpan.FromHours(Flag(flags, "guest_ttl_hours", 24)), ct);
            if (!verdict.Allowed)
                return GuestGuard.Restricted("classify_limit",
                    $"A guest session includes {max} stem classifications — create a free account for more.");
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            log.LogError(ex, "guest stem-classify limiter unavailable — failing CLOSED");
            return DemoCapacity();
        }
        return null;
    }

    // Fix round 1 item 2 — POST /references/{id}/analyze already routes a
    // guest's dispatch to the free lane (QueueFor), but had no cap of its own
    // — a stranger could re-trigger it indefinitely. Same shape as
    // CheckClassifyAsync.
    public async Task<IResult?> CheckReferenceAnalyzeAsync(Guid userId, CancellationToken ct)
    {
        if (string.Equals(cfg["RateLimits:Enabled"], "false", StringComparison.OrdinalIgnoreCase))
            return null;

        var flags = await ents.GetFlagsAsync(ct);
        var max = Flag(flags, "guest_ref_analyze_max", 3);
        var key = $"guest_ref_analyze:{userId}";
        try
        {
            var verdict = await limiter.CheckAsync(
                key, key, "guest_ref_analyze", max,
                TimeSpan.FromHours(Flag(flags, "guest_ttl_hours", 24)), ct);
            if (!verdict.Allowed)
                return GuestGuard.Restricted("reference_analyze_limit",
                    $"A guest session includes {max} reference analyses — create a free account for more.");
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            log.LogError(ex, "guest reference-analyze limiter unavailable — failing CLOSED");
            return DemoCapacity();
        }
        return null;
    }

    // GET /api/me/guest — lets the frontend flip "+ Upload" to "Create free account".
    public async Task<GuestStateDto> GetStateAsync(User guest, CancellationToken ct)
    {
        var flags = await ents.GetFlagsAsync(ct);
        var uploadsMax = Flag(flags, "guest_uploads_max", 2);
        var uploadsUsed = await db.SongVersions.CountAsync(v =>
            !v.FilePath.StartsWith("audio/demo/")
            && db.Songs.Any(s => s.Id == v.SongId && s.UserId == guest.Id), ct);
        var analysesMax = Flag(flags, "guest_analyses_max", 6);
        var analysesUsed = await db.UsageEvents.CountAsync(
            e => e.UserId == guest.Id && e.EventType == "analysis", ct);
        var coachMax = Flag(flags, "coach_guest_messages", 20);
        var coachUsed = await db.UsageEvents.CountAsync(
            e => e.UserId == guest.Id && e.EventType == "coach_message", ct);
        var stemsMaxFiles = Flag(flags, "guest_stems_max_files", 12);
        var stemsMaxMb = Flag(flags, "guest_stems_max_mb", 300);
        var referencesMax = Flag(flags, "guest_references_max", 1);
        var referencesUsed = await db.ReferenceTracks.CountAsync(r => r.UserId == guest.Id, ct);
        return new GuestStateDto(
            uploadsUsed, uploadsMax, analysesUsed, analysesMax, coachUsed, coachMax, guest.GuestExpiresAt,
            stemsMaxFiles, stemsMaxMb, referencesUsed, referencesMax);
    }

    // Copy rule (solo principle, spec D2/D5): never describe load or other
    // visitors — no "busy", "queued", "too many visitors".
    private static IResult DemoCapacity() => ErrorEnvelope.Build(503, "demo_capacity",
        "The demo sandbox can't start new analyses right now — create a free account to analyze your track.");
}
