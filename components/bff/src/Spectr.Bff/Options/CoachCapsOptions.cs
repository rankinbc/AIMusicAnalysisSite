namespace Spectr.Bff.Options;

// Story 1.9 / AR40: per-analysis free-tier coach follow-up cap. Read in
// CoachConversationEndpoints.PostMessage and surfaced via the `caps` field on
// CoachConversationDto + CreateCoachMessageResponse. The `= 3` default is the
// config-default fallback called out in AC4 — the cap functions with no
// appsettings entry present (pre-Epic-2). Story 2.6 will swap the lookup for
// the Entitlements.For(user) resolver + usage_events source-of-truth; this
// shape is forward-compatible (`Tier`, `ResetsAt` fields can be added without
// a breaking wire change).
public sealed class CoachCapsOptions
{
    public const string SectionName = "CoachCaps";

    public int FreeFollowups { get; init; } = 3;
}
