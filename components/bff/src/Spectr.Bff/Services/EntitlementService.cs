using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Spectr.Bff.DTOs;
using Spectr.Data;

namespace Spectr.Bff.Services;

// Story 2.4 / AR12 — the single authoritative entitlement resolver.
// Pure read: no writes; no Stripe API calls.
// Cache key  : "ent:{userId:N}"   — 60 s absolute TTL
// Flag cache : "feature_flags_global" — 60 s absolute TTL
//
// Tier derivation:
//   "pro"     : subscription.status IN ('active','past_due')
//   "credits" : no active sub AND credit_balance >= 1
//   "free"    : all other cases
//
// results-forever guarantee (AR15): this service is NEVER injected into
// the job-status or results handlers — those paths have no entitlement
// gate.

public class EntitlementService(
    AppDbContext db,
    IMemoryCache cache,
    IConfiguration config,
    ILogger<EntitlementService> logger)
{
    private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(60);
    private const string FlagCacheKey = "feature_flags_global";

    public virtual async Task<EntitlementsDto> ForAsync(Guid userId, CancellationToken ct)
    {
        var cacheKey = $"ent:{userId:N}";
        if (cache.TryGetValue(cacheKey, out EntitlementsDto? cached) && cached is not null)
            return cached;

        var result = await ComputeAsync(userId, ct);
        cache.Set(cacheKey, result, new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = CacheTtl,
        });
        return result;
    }

    public void InvalidateAsync(Guid userId)
        => cache.Remove($"ent:{userId:N}");

    public async Task<Dictionary<string, string>> GetFlagsAsync(CancellationToken ct)
    {
        if (cache.TryGetValue(FlagCacheKey, out Dictionary<string, string>? flags) && flags is not null)
            return flags;

        var rows = await db.FeatureFlags
            .AsNoTracking()
            .ToListAsync(ct);

        var dict = rows.ToDictionary(f => f.Name, f => f.Value);
        cache.Set(FlagCacheKey, dict, new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = CacheTtl,
        });
        return dict;
    }

    // credits_enabled — the kill switch for the whole credit system.
    // Precedence: the `Credits:Enabled` config key (env var / UseSetting —
    // same knob pattern as RateLimits:Enabled; the test suite pins it "true"
    // so the DB seed can't flip test semantics), then the live
    // `credits_enabled` feature-flag row. Missing everywhere ⇒ true (credits
    // on); anything except an explicit "false" keeps credits on, so a
    // mistyped value fails toward enforcement. Shared with CoachCapService
    // (the only other resolver that branches on tier).
    public static bool CreditsEnabled(IConfiguration config, Dictionary<string, string> flags)
    {
        var value = config["Credits:Enabled"];
        if (string.IsNullOrEmpty(value))
            flags.TryGetValue("credits_enabled", out value);
        return value is null
            || !string.Equals(value, "false", StringComparison.OrdinalIgnoreCase);
    }

    // Instance overload so CoachCapService (which already injects this
    // service) shares the config override without injecting IConfiguration.
    public bool CreditsEnabled(Dictionary<string, string> flags)
        => CreditsEnabled(config, flags);

    private async Task<EntitlementsDto> ComputeAsync(Guid userId, CancellationToken ct)
    {
        // 0. Credit-system kill switch (credits_enabled=false): everyone is
        // premium. Tier "pro" makes every downstream gate — dispatch caps,
        // abuse arms, credit spend, queue routing, worker identifiers,
        // room-hosting rank — behave as paid, with zero per-site conditionals.
        // Checked before the per-user queries so the whole aggregate read is
        // skipped. CreditsEnabled=false in the DTO tells the frontend to hide
        // billing/tier UI.
        Dictionary<string, string> flagMap;
        try
        {
            flagMap = await GetFlagsAsync(ct);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to load feature flags — using defaults");
            flagMap = new Dictionary<string, string>();
        }

        if (!CreditsEnabled(config, flagMap))
        {
            return new EntitlementsDto(
                AnalysesRemaining: null,
                CoachRemaining: int.MaxValue,
                StemsEnabled: true,
                AlsEnabled: true,
                FullVerdictsEnabled: true,
                HistoryDepth: null,
                Tier: "pro",
                Coach: new CoachCapsDto(
                    0, int.MaxValue, false, CoachCapService.ScopeUnlimited, null),
                AnalysesResetsAt: null,
                CreditsEnabled: false);
        }

        // 1. Subscription status
        var sub = await db.Subscriptions
            .AsNoTracking()
            .Where(s => s.UserId == userId)
            .OrderByDescending(s => s.UpdatedAt)
            .FirstOrDefaultAsync(ct);

        var isPro = sub is not null
            && (sub.Status == "active" || sub.Status == "past_due");

        // 2. Credit balance
        var balance = await db.CreditLedger
            .AsNoTracking()
            .Where(e => e.UserId == userId)
            .SumAsync(e => (int?)e.Amount, ct) ?? 0;

        // 3. Period usage (analyses this calendar month). Story 3.2 (AR16):
        // an invalid_file failure must not consume the free monthly cap —
        // credits get a ledger reversal (JobEndpoints hook), and the free/pro
        // meter compensates HERE at read time by excluding usage events whose
        // job failed validation. Read-side exclusion = no second write path,
        // no idempotency race.
        var billingPeriod = DateTimeOffset.UtcNow.ToString("yyyy-MM");
        var usedThisPeriod = await db.UsageEvents
            .AsNoTracking()
            .CountAsync(e => e.UserId == userId
                && e.EventType == "analysis"
                && e.BillingPeriod == billingPeriod
                && !db.AnalysisJobs.Any(j =>
                    j.ErrorCode == "invalid_file" && j.Id.ToString() == e.Reference), ct);

        // 4. Feature flags (loaded up top for the kill-switch check)
        var freeCap = GetFlag(flagMap, "free_analyses_per_month", 3);
        var coachFreeCap = GetFlag(flagMap, "coach_free_followups", 3);
        var historyFree = GetFlag(flagMap, "history_depth_free", 10);
        var historyCredits = GetFlag(flagMap, "history_depth_credits", 30);

        // 5. Derive tier + entitlements
        if (isPro)
        {
            // Story 2.8 — pooled monthly coach pool. Single-sourced through
            // CoachCapService.ResolveProPoolAsync (static, so no DI cycle) so
            // the usage-page figure can never drift from the send-time gate.
            var coach = await CoachCapService.ResolveProPoolAsync(
                db, flagMap, userId, billingPeriod, ct);
            return new EntitlementsDto(
                AnalysesRemaining: null,
                CoachRemaining: Math.Max(0, coach.Limit - coach.Used),
                StemsEnabled: true,
                AlsEnabled: true,
                FullVerdictsEnabled: true,
                HistoryDepth: null,
                Tier: "pro",
                Coach: new CoachCapsDto(
                    coach.Used, coach.Limit, coach.CapReached, coach.Scope, coach.ResetsAt),
                AnalysesResetsAt: null);
        }

        if (balance >= 1)
        {
            return new EntitlementsDto(
                AnalysesRemaining: balance,
                CoachRemaining: int.MaxValue,
                StemsEnabled: true,
                AlsEnabled: true,
                FullVerdictsEnabled: true,
                HistoryDepth: historyCredits,
                Tier: "credits",
                Coach: new CoachCapsDto(
                    0, int.MaxValue, false, CoachCapService.ScopeUnlimited, null),
                AnalysesResetsAt: null);
        }

        // free tier
        var remaining = Math.Max(0, freeCap - usedThisPeriod);
        return new EntitlementsDto(
            AnalysesRemaining: remaining,
            CoachRemaining: coachFreeCap,
            StemsEnabled: false,
            AlsEnabled: false,
            FullVerdictsEnabled: false,
            HistoryDepth: historyFree,
            Tier: "free",
            AnalysesLimit: freeCap,
            AnalysesUsed: usedThisPeriod,
            // Per-analysis coach scope: no pooled "used" on the usage page (no
            // analysis in scope here), so Used=0; the per-analysis gate is still
            // enforced by CoachCapService at send time.
            Coach: new CoachCapsDto(
                0, coachFreeCap, false, CoachCapService.ScopeAnalysis, null),
            // Free analyses reset on the YYYY-MM billing-period boundary.
            AnalysesResetsAt: CoachCapService.FirstOfNextMonthUtc());
    }

    private static int GetFlag(Dictionary<string, string> flags, string key, int fallback)
    {
        if (flags.TryGetValue(key, out var raw) && int.TryParse(raw, out var val))
            return val;
        return fallback;
    }
}
