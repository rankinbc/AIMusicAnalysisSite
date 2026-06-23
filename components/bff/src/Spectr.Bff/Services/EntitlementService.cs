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

    private async Task<EntitlementsDto> ComputeAsync(Guid userId, CancellationToken ct)
    {
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

        // 3. Period usage (analyses this calendar month)
        var billingPeriod = DateTimeOffset.UtcNow.ToString("yyyy-MM");
        var usedThisPeriod = await db.UsageEvents
            .AsNoTracking()
            .CountAsync(e => e.UserId == userId
                && e.EventType == "analysis"
                && e.BillingPeriod == billingPeriod, ct);

        // 4. Feature flags
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

        var freeCap = GetFlag(flagMap, "free_analyses_per_month", 3);
        var coachFreeCap = GetFlag(flagMap, "coach_free_followups", 3);
        var historyFree = GetFlag(flagMap, "history_depth_free", 10);
        var historyCredits = GetFlag(flagMap, "history_depth_credits", 30);

        // 5. Derive tier + entitlements
        if (isPro)
        {
            return new EntitlementsDto(
                AnalysesRemaining: null,
                CoachRemaining: int.MaxValue,
                StemsEnabled: true,
                AlsEnabled: true,
                FullVerdictsEnabled: true,
                HistoryDepth: null,
                Tier: "pro");
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
                Tier: "credits");
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
            AnalysesUsed: usedThisPeriod);
    }

    private static int GetFlag(Dictionary<string, string> flags, string key, int fallback)
    {
        if (flags.TryGetValue(key, out var raw) && int.TryParse(raw, out var val))
            return val;
        return fallback;
    }
}
