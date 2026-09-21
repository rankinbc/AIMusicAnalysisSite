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

    // Checked by the guard for `.AllowGuestUpload()` routes, BEFORE the
    // handler runs. Counts versions the guest actually uploaded — the seeded
    // demo version lives under `audio/demo/` and is excluded, so it can never
    // consume the guest's one real upload.
    public async Task<IResult?> CheckUploadAsync(Guid userId, CancellationToken ct)
    {
        var flags = await ents.GetFlagsAsync(ct);
        var max = Flag(flags, "guest_uploads_max", 1);
        var used = await db.SongVersions.CountAsync(v =>
            !v.FilePath.StartsWith("audio/demo/")
            && db.Songs.Any(s => s.Id == v.SongId && s.UserId == userId), ct);
        return used >= max
            ? GuestGuard.Restricted("upload_limit",
                "The demo sandbox includes one upload — create a free account to analyze more.")
            : null;
    }

    // Called at the top of DispatchAnalysisAsync when the caller is a guest.
    // Two independent gates: (1) the guest's OWN analysis count (append-only
    // usage_events — cannot be gamed by delete + re-upload, since deletes are
    // denied by the guard anyway), then (2) the GLOBAL guest-lane arm, which
    // FAILS CLOSED — a limiter/flag/DB failure here must never let an
    // unbounded number of guest analyses onto the single VM.
    public async Task<IResult?> CheckAnalysisAsync(Guid userId, HttpContext http, CancellationToken ct)
    {
        _ = http; // reserved for future per-request context; keeps the signature stable
        var flags = await ents.GetFlagsAsync(ct);
        var max = Flag(flags, "guest_uploads_max", 1);
        var used = await db.UsageEvents.CountAsync(
            e => e.UserId == userId && e.EventType == "analysis", ct);
        if (used >= max)
            return GuestGuard.Restricted("analysis_limit",
                "The demo sandbox includes one analysis — create a free account to analyze more.");

        var rateLimitsEnabled = !string.Equals(cfg["RateLimits:Enabled"], "false", StringComparison.OrdinalIgnoreCase);
        if (!rateLimitsEnabled) return null;

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
