using Microsoft.EntityFrameworkCore;
using Spectr.Bff.DTOs;
using Spectr.Data;

namespace Spectr.Bff.Services;

// Story 2.6 / FR15 — tier-aware coach follow-up caps. The single place that
// answers "how many coach messages has this user used, and what's the cap"
// for a given analysis. Used by CoachConversationEndpoints for BOTH the
// pre-send gate (PostMessage) and the chip state (GetConversation).
//
// This is the COUNT guard half of the two-guard model (AR8): it gates the
// number of messages. The LLM gateway gates SPEND (USD) independently in the
// worker — neither knows about the other.
//
// Tier semantics (derived from EntitlementService — AR12):
//   pro      → POOLED MONTHLY across all analyses; limit = `coach_pro_monthly`
//              flag; used = count of `coach_message` usage_events this period.
//   free     → PER-ANALYSIS; limit = `coach_free_followups` flag (AC2: now from
//              the resolver, not IOptions<CoachCapsOptions>); used = count of
//              user coach_messages in THIS analysis's conversation.
//   credits  → UNLIMITED (no gate) — matches EntitlementsDto.CoachRemaining =
//              int.MaxValue for the credits tier.
public sealed class CoachCapService(AppDbContext db, EntitlementService ents)
{
    public const string ScopeAnalysis = "analysis";
    public const string ScopeMonth = "month";
    public const string ScopeUnlimited = "unlimited";

    private const int CoachProMonthlyDefault = 300;
    private const int CoachFreeFollowupsDefault = 3;

    // Resolve the current cap state for (user, analysis). Pure read.
    public async Task<CoachCapState> ResolveAsync(Guid userId, Guid analysisId, CancellationToken ct)
    {
        var ent = await ents.ForAsync(userId, ct);

        if (ent.Tier == "pro")
        {
            var flags = await ents.GetFlagsAsync(ct);
            var limit = GetFlag(flags, "coach_pro_monthly", CoachProMonthlyDefault);
            var period = DateTimeOffset.UtcNow.ToString("yyyy-MM");
            var used = await db.UsageEvents.AsNoTracking()
                .CountAsync(e => e.UserId == userId
                    && e.EventType == "coach_message"
                    && e.BillingPeriod == period, ct);
            return new CoachCapState(
                Used: used,
                Limit: limit,
                CapReached: used >= limit,
                Scope: ScopeMonth,
                ResetsAt: FirstOfNextMonthUtc());
        }

        if (ent.Tier == "credits")
        {
            // Unlimited coach for credits (parity with EntitlementsDto). No
            // count query needed — the gate never trips.
            return new CoachCapState(
                Used: 0,
                Limit: int.MaxValue,
                CapReached: false,
                Scope: ScopeUnlimited,
                ResetsAt: null);
        }

        // free tier — per-analysis cap.
        var freeFlags = await ents.GetFlagsAsync(ct);
        var freeLimit = GetFlag(freeFlags, "coach_free_followups", CoachFreeFollowupsDefault);
        var conversationId = await db.Conversations.AsNoTracking()
            .Where(c => c.AnalysisId == analysisId && c.UserId == userId)
            .Select(c => (Guid?)c.Id)
            .FirstOrDefaultAsync(ct);
        var usedFree = conversationId is null
            ? 0
            : await db.CoachMessages.AsNoTracking()
                .CountAsync(m => m.ConversationId == conversationId && m.Role == "user", ct);
        return new CoachCapState(
            Used: usedFree,
            Limit: freeLimit,
            CapReached: usedFree >= freeLimit,
            Scope: ScopeAnalysis,
            ResetsAt: null);
    }

    public CoachCapsDto ToDto(CoachCapState s)
        => new(s.Used, s.Limit, s.CapReached, s.Scope, s.ResetsAt);

    // First instant (UTC) of the next calendar month — when a pooled monthly
    // allowance resets. Matches the YYYY-MM billing-period boundary.
    private static DateTimeOffset FirstOfNextMonthUtc()
    {
        var now = DateTimeOffset.UtcNow;
        var firstThisMonth = new DateTimeOffset(now.Year, now.Month, 1, 0, 0, 0, TimeSpan.Zero);
        return firstThisMonth.AddMonths(1);
    }

    private static int GetFlag(Dictionary<string, string> flags, string key, int fallback)
        => flags.TryGetValue(key, out var raw) && int.TryParse(raw, out var val) ? val : fallback;
}

// Resolved cap state for an analysis. `Scope`/`ResetsAt` mirror CoachCapsDto.
public sealed record CoachCapState(
    int Used,
    int Limit,
    bool CapReached,
    string Scope,
    DateTimeOffset? ResetsAt);
