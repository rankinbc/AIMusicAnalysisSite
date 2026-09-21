using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Endpoints;
using Spectr.Data;
using Spectr.Data.Entities;

namespace Spectr.Bff.Services;

// Task D6 (spec D5) — the guest's own quotas: ONE upload, ONE analysis, plus
// the global fail-closed hourly arm on analysis dispatch. Scoped (per-request
// AppDbContext). Both CheckUploadAsync and CheckAnalysisAsync key off
// `guest_uploads_max` (default 1) — the flag literally means "one of each",
// by design (spec D5).
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
                    TimeSpan.FromHours(Flag(flags, "guest_ttl_hours", 72)), ct);
                if (!verdict.Allowed)
                    return GuestGuard.Restricted("upload_limit",
                        "The demo sandbox includes one upload — create a free account to analyze more.");
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
                "The demo sandbox includes one upload — create a free account to analyze more.")
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
                TimeSpan.FromHours(Flag(flags, "guest_ttl_hours", 72)), ct);
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
        var max = Flag(flags, "guest_uploads_max", 1);
        var used = await db.UsageEvents.CountAsync(
            e => e.UserId == userId && e.EventType == "analysis", ct);
        if (used >= max)
            return GuestGuard.Restricted("analysis_limit",
                "The demo sandbox includes one analysis — create a free account to analyze more.");

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

    // GET /api/me/guest — lets the frontend flip "+ Upload" to "Create free account".
    public async Task<GuestStateDto> GetStateAsync(User guest, CancellationToken ct)
    {
        var flags = await ents.GetFlagsAsync(ct);
        var uploadsMax = Flag(flags, "guest_uploads_max", 1);
        var uploadsUsed = await db.SongVersions.CountAsync(v =>
            !v.FilePath.StartsWith("audio/demo/")
            && db.Songs.Any(s => s.Id == v.SongId && s.UserId == guest.Id), ct);
        var analysesUsed = await db.UsageEvents.CountAsync(
            e => e.UserId == guest.Id && e.EventType == "analysis", ct);
        var coachMax = Flag(flags, "coach_guest_messages", 20);
        var coachUsed = await db.UsageEvents.CountAsync(
            e => e.UserId == guest.Id && e.EventType == "coach_message", ct);
        return new GuestStateDto(
            uploadsUsed, uploadsMax, analysesUsed, uploadsMax, coachUsed, coachMax, guest.GuestExpiresAt);
    }

    // Copy rule (solo principle, spec D2/D5): never describe load or other
    // visitors — no "busy", "queued", "too many visitors".
    private static IResult DemoCapacity() => ErrorEnvelope.Build(503, "demo_capacity",
        "The demo sandbox can't start new analyses right now — create a free account to analyze your track.");
}
