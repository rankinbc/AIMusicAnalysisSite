using System.Security.Claims;
using Spectr.Bff.Auth;

namespace Spectr.Bff.Services;

// Fix wave FW1 (final review C1) — on-demand specialist runs.
public sealed partial class GuestLimits
{
    // Outcome of ClaimSpecialistRunAsync. Enqueue=false with Error=null means
    // "an identical run is already in flight": the caller answers exactly
    // what a fresh dispatch answers, without enqueueing anything.
    public readonly record struct SpecialistRunClaim(bool Enqueue, IResult? Error, string? InflightToken);

    // 600 s outlives two full actor attempts: run_specialist declares
    // `max_retries=1, time_limit=180_000` (components/worker/app/verdict_actor.py),
    // so one message can hold the LLM for at most 2 x 180 s. Past that the
    // worker has either written a verdict row (the endpoint's "already has a
    // verdict" 409 takes over) or died, and a fresh POST may dispatch again.
    internal static readonly TimeSpan SpecialistInflightTtl = TimeSpan.FromSeconds(600);

    internal static string SpecialistInflightKey(Guid analysisId, string slug)
        => $"specialist_inflight:{analysisId}:{slug}";

    // Called by RunSpecialist for EVERY caller, after ownership and the
    // verdict-row check, before anything is enqueued. The run_specialist
    // actor has no "already running" check of its own, so without this every
    // POST before the worker finishes (a reload, a double click, a script)
    // dispatches another LLM run and another verdict row.
    //
    // Order matters: the in-flight SET NX comes FIRST, so a duplicate never
    // consumes one of a guest's runs; the guest cap is charged only when an
    // enqueue will actually follow.
    public async Task<SpecialistRunClaim> ClaimSpecialistRunAsync(
        ClaimsPrincipal user, Guid analysisId, string slug, CancellationToken ct)
    {
        var isGuest = user.IsGuest();
        var key = SpecialistInflightKey(analysisId, slug);
        string? token;
        try
        {
            // SET key <token> NX PX 600000 — the token value is never read.
            token = await distLock.TryAcquireAsync(key, SpecialistInflightTtl, ct);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            if (isGuest)
            {
                log.LogError(ex, "specialist in-flight marker unavailable — failing CLOSED for a guest");
                return new SpecialistRunClaim(false, DemoCapacityNeutral(), null);
            }
            // A real user's run must not break on a Redis blip: dispatch
            // without the dedupe, exactly as before this key existed.
            log.LogWarning(ex, "specialist in-flight marker unavailable — dispatching without dedupe");
            return new SpecialistRunClaim(true, null, null);
        }

        if (token is null) return new SpecialistRunClaim(false, null, null);

        if (isGuest && await CheckSpecialistRunAsync(user.UserId(), ct) is { } denied)
        {
            // Nothing will be enqueued — drop the marker, or the next POST
            // would answer "queued" for a run that never started.
            await ReleaseSpecialistRunAsync(analysisId, slug, token);
            return new SpecialistRunClaim(false, denied, null);
        }
        return new SpecialistRunClaim(true, null, token);
    }

    // Best-effort, only for a claim whose enqueue did NOT happen. A
    // successful dispatch keeps its key until it expires.
    public async Task ReleaseSpecialistRunAsync(Guid analysisId, string slug, string? token)
    {
        if (token is null) return;
        try
        {
            await distLock.ReleaseAsync(SpecialistInflightKey(analysisId, slug), token, CancellationToken.None);
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "specialist in-flight marker release failed — its TTL will reclaim it");
        }
    }

    // The guest's own specialist-run allowance. Same shape as
    // CheckFixRackAsync: atomic sliding window keyed per guest, window = the
    // guest TTL, fails CLOSED.
    public async Task<IResult?> CheckSpecialistRunAsync(Guid userId, CancellationToken ct)
    {
        if (string.Equals(cfg["RateLimits:Enabled"], "false", StringComparison.OrdinalIgnoreCase))
            return null;

        var key = $"guest_specialist:{userId}";
        try
        {
            var flags = await ents.GetFlagsAsync(ct);
            var max = Flag(flags, "guest_specialist_runs_max", 12);
            var verdict = await limiter.CheckAsync(
                key, key, "guest_specialist", max,
                TimeSpan.FromHours(Flag(flags, "guest_ttl_hours", 24)), ct);
            if (!verdict.Allowed)
                return GuestGuard.Restricted("specialist_limit",
                    $"A guest session includes {max} specialist reviews — create a free account for more.");
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            log.LogError(ex, "guest specialist-run limiter unavailable — failing CLOSED");
            return DemoCapacityNeutral();
        }
        return null;
    }
}
