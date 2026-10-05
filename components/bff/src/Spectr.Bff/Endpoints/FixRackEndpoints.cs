using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using System.Security.Claims;
using System.Text.Json;

namespace Spectr.Bff.Endpoints;

// Deterministic SOLVE: turn an analysis's persisted Problems into a loadable
// rack preset. On-demand — POST enqueues the `generate_fix_rack` worker actor,
// which writes a system RackPreset(source='analysis'); GET serves it once ready.
public static class FixRackEndpoints
{
    private const int InFlightWindowMinutes = 10;

    public static IEndpointRouteBuilder MapFixRackEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/reports/{jobId:guid}/fix-rack").WithTags("fix-rack").RequireAuthorization();
        g.MapPost("/", Generate).AllowGuest(); // Task D6 (spec D4)
        g.MapGet("/", GetFixRack);
        return app;
    }

    // POST /api/reports/{jobId}/fix-rack — enqueue rack generation.
    private static async Task<IResult> Generate(
        Guid jobId, ClaimsPrincipal user, AppDbContext db, IJobQueue queue,
        EntitlementService ents, GuestLimits guestLimits, CreditLedgerService credits,
        CancellationToken ct)
    {
        var userId = user.UserId();

        // Fix round 1 item 2: a guest's fix-rack generations are capped
        // separately from the analysis/upload quotas (unbounded otherwise —
        // every POST here enqueues an LLM generation against the shared
        // guest-lane budget).
        if (user.IsGuest() && await guestLimits.CheckFixRackAsync(userId, ct) is { } denied)
            return denied;

        var analysis = await db.Analyses.AsNoTracking()
            .Where(a => a.JobId == jobId && a.UserId == userId)
            .Select(a => new { a.Id, a.VersionId })
            .FirstOrDefaultAsync(ct);
        if (analysis is null) return Results.NotFound();
        if (analysis.VersionId is null)
            return Results.BadRequest(new { error = "Analysis has no song version; cannot attach a rack preset." });

        // Tier gates the coach-mix LLM arbiter's spend attribution in the worker.
        EntitlementsDto entitlements;
        try
        {
            entitlements = await ents.ForAsync(userId, ct);
        }
        catch (Exception)
        {
            return ErrorEnvelope.Build(503, "entitlements_unavailable",
                "Entitlement service temporarily unavailable.");
        }
        var tier = entitlements.Tier; // "pro" | "credits" | "free"

        // Credit economy — each Coach Mix generation costs credits (Pro: included).
        var flags = await ents.GetFlagsAsync(ct);
        var charged = false;
        string? chargeRef = null, refundKey = null;
        if (!user.IsGuest() && ents.CreditsEnabled(flags) && tier != "pro")
        {
            var price = (await ents.GetPricesAsync(ct)).CoachMix;
            var prefix = $"coachmix:{analysis.Id}:";

            // Stable key: n = prior Coach Mix charges for this analysis, so two
            // truly concurrent requests (both read the same n) collapse onto one
            // key — the ledger's unique index makes the loser a replay.
            // n MUST be read before the in-flight check: a twin's charge that
            // commits between the two reads is then caught by the check (which
            // runs later, so it sees everything n saw). In the other order the
            // twin slips past the check and bumps n onto a fresh key — a second
            // charge.
            var n = await db.CreditLedger.AsNoTracking()
                .CountAsync(e => e.UserId == userId && e.Reason == "spend"
                    && e.Reference != null && e.Reference.StartsWith(prefix), ct);

            // A double-click / client retry must not buy a second generation.
            // In flight = this analysis' latest un-refunded Coach Mix charge is
            // recent and no analysis rack has landed since — return it as
            // queued WITHOUT charging or enqueuing. The window bounds a
            // generation that never produces a rack (worker down), so it can't
            // block a deliberate regenerate forever.
            if (price > 0)
            {
                var since = DateTimeOffset.UtcNow.AddMinutes(-InFlightWindowMinutes);
                var lastChargeAt = await db.CreditLedger.AsNoTracking()
                    .Where(e => e.UserId == userId && e.Reason == "spend"
                        && e.Reference != null && e.Reference.StartsWith(prefix) && e.CreatedAt >= since
                        && !db.CreditLedger.Any(r => r.UserId == userId
                            && r.Reason == "reversal" && r.Reference == e.Reference))
                    .OrderByDescending(e => e.CreatedAt)
                    .Select(e => (DateTimeOffset?)e.CreatedAt)
                    .FirstOrDefaultAsync(ct);
                if (lastChargeAt is { } at
                    && !await db.RackPresets.AsNoTracking().AnyAsync(p =>
                        p.SongVersionId == analysis.VersionId!.Value
                        && p.Source == "analysis" && p.CreatedAt >= at, ct))
                    return Results.Accepted(value: new { status = "queued" });
            }

            chargeRef = $"{prefix}{n}";
            refundKey = $"reversal:coachmix:{analysis.Id}:{n}";
            try
            {
                charged = await credits.ChargeAsync(userId, price,
                    chargeRef, $"spend:coachmix:{analysis.Id}:{n}", null, ct) is not null;
                ents.InvalidateAsync(userId);
            }
            catch (InsufficientCreditsException ex)
            {
                return ErrorEnvelope.Build(402, "insufficient_credits",
                    "Not enough credits for a Coach Mix.",
                    new { required = ex.Required, balance = ex.CurrentBalance });
            }
            // Priced but not charged by THIS call ⇒ a concurrent twin already
            // paid for (and enqueued) this generation.
            if (!charged && price > 0)
                return Results.Accepted(value: new { status = "queued" });
        }

        try
        {
            await queue.EnqueueAsync(
                DramatiqTasks.GenerateFixRack,
                new object[] { analysis.Id.ToString(), userId.ToString(), tier },
                // Fix round 1 item 1: guests ride the free lane.
                GuestLimits.AiQueueFor(user), // interactive LLM lane (guests: ai-guest) — never behind batch DSP
                ct);
        }
        catch
        {
            // Never queued — give the credits back (degraded racks are NOT refunded).
            if (charged)
                await credits.RefundChargeAsync(userId, chargeRef!, refundKey!, ct);
            throw;
        }

        return Results.Accepted(value: new { status = "queued" });
    }

    // GET /api/reports/{jobId}/fix-rack — the generated analysis preset, or 204.
    private static async Task<IResult> GetFixRack(
        Guid jobId, ClaimsPrincipal user, AppDbContext db, CancellationToken ct)
    {
        var userId = user.UserId();
        var analysis = await db.Analyses.AsNoTracking()
            .Where(a => a.JobId == jobId && a.UserId == userId)
            .Select(a => new { a.VersionId })
            .FirstOrDefaultAsync(ct);
        if (analysis is null) return Results.NotFound();
        if (analysis.VersionId is null) return Results.NoContent();

        var preset = await db.RackPresets.AsNoTracking()
            .Where(p => p.SongVersionId == analysis.VersionId.Value && p.Source == "analysis")
            .OrderByDescending(p => p.CreatedAt)
            .Select(p => new { p.Id, p.Name, p.ChainJson, p.CoachMeta, p.CreatedAt })
            .FirstOrDefaultAsync(ct);
        if (preset is null) return Results.NoContent();

        JsonElement chain;
        try
        {
            using var doc = JsonDocument.Parse(preset.ChainJson);
            chain = doc.RootElement.Clone();
        }
        catch (JsonException)
        {
            return Results.NoContent();
        }

        JsonElement? coachMeta = null;
        if (!string.IsNullOrEmpty(preset.CoachMeta))
        {
            try
            {
                using var cm = JsonDocument.Parse(preset.CoachMeta);
                coachMeta = cm.RootElement.Clone();
            }
            catch (JsonException) { coachMeta = null; }
        }

        // Story 12.4: PresetId is the Listen carry-over handle — the panel's
        // "Open in Listen rack" passes it as ?fixPreset= and the Listen page
        // fetches the chain back via GET /versions/{v}/rack/presets/{id}.
        return Results.Ok(new FixRackDto(preset.Id, preset.Name, chain, coachMeta, preset.CreatedAt));
    }
}
