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
// Fix wave FW1 — partial: the fix-wave checks live in the GuestLimits.*.cs
// partial files (this file is near the 500-line limit).
public sealed partial class GuestLimits(
    AppDbContext db, EntitlementService ents, IRateLimiter limiter, IDistributedLock distLock,
    IConfiguration cfg, ILogger<GuestLimits> log, IGuestSlots slots)
{
    // Delegates to the single flag-parsing helper (GuestIdentity.Flag) so
    // every guest-flag read in the codebase agrees on missing/garbage → fallback.
    public static int Flag(Dictionary<string, string> flags, string name, int fallback)
        => GuestIdentity.Flag(flags, name, fallback);

    // Fix round 1 item 1 — guest LLM work (lazy Triage, on-demand specialists,
    // fix-rack generation) rides the free lane, whatever queue the caller's
    // tier would otherwise route to. The worker dispatches by actor_name, so
    // an actor declared on `ai` is consumed fine from analysis-free (every
    // actor is registered in every worker process via app.dramatiq_app, and
    // analyze_audio_job keeps analysis-free declared); real users are
    // unaffected (defaultQueue passes through unchanged).
    // Interactive AI lane decision: guests stay OFF `ai` — that pool serves
    // real users' coach replies + Triage, and demo traffic must never take
    // its threads. Guest *analysis* work (QueueFor) rides the free lane.
    public static string QueueFor(ClaimsPrincipal user, string defaultQueue)
        => user.IsGuest() ? DramatiqQueues.AnalysisFree : defaultQueue;

    // Guest INTERACTIVE AI work (triage, specialists, Coach Mix) rides its own
    // `ai-guest` lane — a small one-thread worker (worker-guest-ai) — so it
    // neither takes real users' `ai` threads nor waits behind multi-minute
    // batch analyses on the free lane. Real users pass through to `ai`.
    public static string AiQueueFor(ClaimsPrincipal user)
        => user.IsGuest() ? DramatiqQueues.AiGuest : DramatiqQueues.Ai;

    // Checked by the guard for `.AllowGuestUpload()` routes, BEFORE the
    // handler runs. Counts versions the guest actually uploaded — the seeded
    // demo version lives under `audio/demo/` and is excluded, so it can never
    // consume the guest's one real upload.
    //
    // Fix wave FW1 (I1) — a pre-check only: it CHARGES nothing. The atomic
    // race guard is the upload-slot ledger (GuestLimits.Uploads.cs), charged
    // once per upload — around the proxy handler by the guard, at
    // /uploads/init for the presigned path. (It used to charge a limiter hit
    // here, on BOTH /init and /complete, so one presigned upload spent two
    // of the guest's slots.)
    // Fix wave FW1 (M6) — flags and the DB count are read inside the try: a
    // DB blip answers the friendly 503 (fail closed), never a raw 500.
    public async Task<IResult?> CheckUploadAsync(Guid userId, CancellationToken ct)
    {
        try
        {
            var flags = await ents.GetFlagsAsync(ct);
            var max = Flag(flags, "guest_uploads_max", 2);
            var used = await db.SongVersions.CountAsync(v =>
                !v.FilePath.StartsWith("audio/demo/")
                && db.Songs.Any(s => s.Id == v.SongId && s.UserId == userId), ct);
            return used >= max ? UploadLimit(max) : null;
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            log.LogError(ex, "guest upload quota unreadable — failing CLOSED");
            return DemoCapacity();
        }
    }

    private static IResult UploadLimit(int max) => GuestGuard.Restricted("upload_limit",
        $"A guest session includes {max} uploads — create a free account to analyze more.");

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

        var key = $"guest_fix_rack:{userId}";
        try
        {
            // Task G7a (minor) — moved inside the try: a flags/DB failure
            // here used to answer a raw 500 instead of the friendly 503.
            var flags = await ents.GetFlagsAsync(ct);
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
    public async Task<IResult?> CheckAnalysisAsync(Guid userId, Guid versionId, HttpContext http, CancellationToken ct)
    {
        var flags = await ents.GetFlagsAsync(ct);
        if (await AnalysisCountRefusalAsync(userId, flags, ct) is { } over) return over;

        if (!RateLimitsEnabled) return null;

        // Fix wave FW1 (I1) — a presigned upload already charged the per-IP
        // and global arms at /uploads/init; the first dispatch for its
        // version spends that charge instead of charging a second time.
        if (await TryConsumePrechargedAnalysisAsync(userId, versionId)) return null;
        return await ChargeAnalysisArmsAsync(flags, http, ct);
    }

    // Task G1 — analyses are no longer 1:1 with uploads: a guest may
    // re-analyze the same version (Reanalyze, stems confirm, .als attach)
    // many times within their own analysis budget, independent of how many
    // versions they uploaded. `guest_analyses_max` (6) replaces
    // `guest_uploads_max` (2) as the source of this cap.
    private async Task<IResult?> AnalysisCountRefusalAsync(
        Guid userId, Dictionary<string, string> flags, CancellationToken ct)
    {
        var max = Flag(flags, "guest_analyses_max", 6);
        var used = await db.UsageEvents.CountAsync(
            e => e.UserId == userId && e.EventType == "analysis", ct);
        return used >= max
            ? GuestGuard.Restricted("analysis_limit",
                $"A guest session includes {max} analyses — create a free account to analyze more.")
            : null;
    }

    private bool RateLimitsEnabled
        => !string.Equals(cfg["RateLimits:Enabled"], "false", StringComparison.OrdinalIgnoreCase);

    // The per-IP and global guest-analysis arms (hourly windows), CHARGED:
    // IRateLimiter records a hit on every allowed call.
    private async Task<IResult?> ChargeAnalysisArmsAsync(
        Dictionary<string, string> flags, HttpContext http, CancellationToken ct)
    {
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
            return DemoCapacityNeutral();
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

    // Fix round 1 item 4(a) — reject an over-budget guest body from its raw
    // Content-Length BEFORE ReadFormAsync buffers the whole multipart body
    // (the route's own size limit is ~5 GB). Content-Length is a proxy for
    // the files inside a multipart body (always >= their combined bytes, due
    // to boundaries/headers), so a legitimate request under budget is never
    // falsely rejected once the 1 MB multipart slack is added. Fails CLOSED
    // like CheckStemsAsync.
    private const long MultipartSlackBytes = 1L * 1024 * 1024;

    public async Task<IResult?> CheckStemsContentLengthAsync(
        long existingBytes, long? contentLength, CancellationToken ct)
    {
        Dictionary<string, string> flags;
        try
        {
            flags = await ents.GetFlagsAsync(ct);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            log.LogError(ex, "guest stems content-length flags unavailable — failing CLOSED");
            return DemoCapacityNeutral();
        }

        var maxMb = Flag(flags, "guest_stems_max_mb", 300);
        var maxBytes = (long)maxMb * 1024 * 1024;
        var remaining = Math.Max(0, maxBytes - existingBytes);
        if (contentLength is null || contentLength > remaining + MultipartSlackBytes)
            return GuestGuard.Restricted("stems_limit",
                $"A guest session includes {maxMb} MB of stems per version — create a free account to add more.");
        return null;
    }

    // Fix round 1 item 4(b) — stems/stage is check-then-write on the
    // per-version stem count/bytes (ReadRaw → append → SaveChanges); N
    // parallel guest requests each read the SAME "before" state and can all
    // pass CheckStemsAsync, so the version ends up well over its cap. A
    // short-lived per-guest Redis lock serialises one guest's OWN stage
    // calls (keyed by userId — no other guest is ever blocked by this).
    private static readonly TimeSpan StemsLockTtl = TimeSpan.FromMilliseconds(120_000);

    public readonly record struct StemsLockResult(bool Ok, string? Token, IResult? Error);

    public async Task<StemsLockResult> AcquireStemsLockAsync(Guid userId, CancellationToken ct)
    {
        var key = $"guest_stems_lock:{userId}";
        try
        {
            var token = await distLock.TryAcquireAsync(key, StemsLockTtl, ct);
            if (token is null)
                return new StemsLockResult(false, null, ErrorEnvelope.Build(429, "guest_busy",
                    "One upload at a time — try again in a moment."));
            return new StemsLockResult(true, token, null);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            log.LogError(ex, "guest stems lock unavailable — failing CLOSED");
            return new StemsLockResult(false, null, DemoCapacityNeutral());
        }
    }

    // Best-effort release — called from the handler's `finally`. A failure
    // here is harmless: the PX 120000 TTL above reclaims the key on its own,
    // which is also what rescues a request that died mid-upload and never
    // reached this line at all.
    public async Task ReleaseStemsLockAsync(Guid userId, string token)
    {
        try
        {
            await distLock.ReleaseAsync($"guest_stems_lock:{userId}", token, CancellationToken.None);
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "guest stems lock release failed — TTL will reclaim it");
        }
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
            return DemoCapacityNeutral();
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
            return DemoCapacityNeutral();
        }

        // Fix round 1 minor — plural agreement (the flag can be raised above 1).
        var noun = max == 1 ? "reference track" : "reference tracks";
        return used >= max
            ? GuestGuard.Restricted("reference_limit",
                $"A guest session includes {max} {noun} — create a free account to add more.")
            : null;
    }

    // Fix round 1 item 2 — stems/classify enqueued on EVERY call with no
    // per-guest cap. Same shape as CheckFixRackAsync: atomic limiter, keyed
    // per guest, window = guest TTL, fails CLOSED.
    public async Task<IResult?> CheckClassifyAsync(Guid userId, CancellationToken ct)
    {
        if (string.Equals(cfg["RateLimits:Enabled"], "false", StringComparison.OrdinalIgnoreCase))
            return null;

        var key = $"guest_classify:{userId}";
        try
        {
            // Task G7a (minor) — moved inside the try: a flags/DB failure
            // here used to answer a raw 500 instead of the friendly 503.
            var flags = await ents.GetFlagsAsync(ct);
            var max = Flag(flags, "guest_classify_max", 6);
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
            return DemoCapacityNeutral();
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

        var key = $"guest_ref_analyze:{userId}";
        try
        {
            // Task G7a (minor) — moved inside the try: a flags/DB failure
            // here used to answer a raw 500 instead of the friendly 503.
            var flags = await ents.GetFlagsAsync(ct);
            var max = Flag(flags, "guest_ref_analyze_max", 3);
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
            return DemoCapacityNeutral();
        }
        return null;
    }

    // Fix round 1 item 3 — every presigned mint is a byte allowance no DB row
    // tracks until the object is registered (stage-keys/als-key/complete-key)
    // and mints a fresh random id every call, so a loop can spin unlimited
    // presigned PUT URLs of bytes no row tracks and no sweep finds. Checked
    // BEFORE any URL is minted, for every kind. Same shape as
    // CheckClassifyAsync — atomic limiter, fails CLOSED.
    public async Task<IResult?> CheckAttachmentMintAsync(Guid userId, CancellationToken ct)
    {
        if (string.Equals(cfg["RateLimits:Enabled"], "false", StringComparison.OrdinalIgnoreCase))
            return null;

        var key = $"guest_attach_init:{userId}";
        try
        {
            // Task G7a (minor) — moved inside the try: a flags/DB failure
            // here used to answer a raw 500 instead of the friendly 503.
            var flags = await ents.GetFlagsAsync(ct);
            var max = Flag(flags, "guest_attachment_mints_max", 30);
            var verdict = await limiter.CheckAsync(
                key, key, "guest_attach_init", max,
                TimeSpan.FromHours(Flag(flags, "guest_ttl_hours", 24)), ct);
            if (!verdict.Allowed)
                return GuestGuard.Restricted("mint_limit",
                    $"A guest session includes {max} upload requests — create a free account for more.");
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            log.LogError(ex, "guest attachment-mint limiter unavailable — failing CLOSED");
            return DemoCapacityNeutral();
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

    // Fix round 1 minor (Opus review) — DemoCapacity()'s "can't start new
    // analyses" wording is wrong when the failure isn't about dispatching an
    // analysis at all (a stems/reference/classify/mint flag or lock read).
    // Neutral, scope-agnostic copy for those fail-closed sites.
    private static IResult DemoCapacityNeutral() => ErrorEnvelope.Build(503, "demo_capacity",
        "That isn't available right now — please try again in a moment.");
}
