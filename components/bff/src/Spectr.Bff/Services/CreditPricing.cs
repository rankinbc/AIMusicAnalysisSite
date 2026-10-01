namespace Spectr.Bff.Services;

// Credit economy (PRPs/archive/2026-10-01_credit-economy.md) — the ONE price list. Enforcement
// (every charge site) and display (GET /api/billing/plans) both read this, so a
// label can never disagree with the charge. Units are credits; ~1 credit ≈ 1¢
// of Claude cost. Live-tunable via feature_flags (60 s cache, no redeploy).
public sealed record CreditPrices(
    int Analysis,
    int Specialist,
    int CoachMessage,
    int CoachMix,
    int SignupGrant,
    int ProAnalysesMonthly);

public static class CreditPricing
{
    public static readonly CreditPrices Defaults = new(
        Analysis: 100, Specialist: 15, CoachMessage: 5, CoachMix: 5,
        SignupGrant: 500, ProAnalysesMonthly: 15);

    // Per value: config key (env / UseSetting — the test suite pins legacy
    // values here, same knob pattern as Credits:Enabled) → feature flag →
    // default. Non-integer or negative → next source; 0 is valid ("free").
    public static CreditPrices Resolve(IConfiguration config, IReadOnlyDictionary<string, string> flags) => new(
        Analysis: Get(config, flags, "Credits:Prices:Analysis", "credit_cost_analysis", Defaults.Analysis),
        Specialist: Get(config, flags, "Credits:Prices:Specialist", "credit_cost_specialist", Defaults.Specialist),
        CoachMessage: Get(config, flags, "Credits:Prices:CoachMessage", "credit_cost_coach_message", Defaults.CoachMessage),
        CoachMix: Get(config, flags, "Credits:Prices:CoachMix", "credit_cost_coach_mix", Defaults.CoachMix),
        SignupGrant: Get(config, flags, "Credits:SignupGrant", CreditLedgerService.SignupBonusFlag, Defaults.SignupGrant),
        ProAnalysesMonthly: Get(config, flags, "Credits:ProAnalysesMonthly", "pro_analyses_monthly", Defaults.ProAnalysesMonthly));

    private static int Get(
        IConfiguration config, IReadOnlyDictionary<string, string> flags,
        string configKey, string flagName, int fallback)
    {
        if (TryParse(config[configKey], out var c)) return c;
        if (flags.TryGetValue(flagName, out var raw) && TryParse(raw, out var f)) return f;
        return fallback;
    }

    private static bool TryParse(string? raw, out int value)
        => int.TryParse(raw, out value) && value >= 0;
}
