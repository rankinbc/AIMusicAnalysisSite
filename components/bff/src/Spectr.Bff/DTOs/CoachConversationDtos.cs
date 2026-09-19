namespace Spectr.Bff.DTOs;

// Story 1.5: Coach conversation wire shapes for the new persisted-message
// endpoints under /api/coach/{analysisId}/messages and
// /api/coach/{analysisId}/conversation. Camel-cased on the wire via the
// global JsonSerializerDefaults.Web convention (story 1.4 confirmed).

public sealed record CoachEvidenceDto(string Label, string Path);

public sealed record CoachMessageDto(
    Guid Id,
    string Role,                                  // "user" | "assistant"
    string Status,                                // "pending" | "complete" | "refused" | "error"
    string Content,
    IReadOnlyList<CoachEvidenceDto>? Evidence,   // null on user rows
    string? RefusalReason,                        // set on refused/coach_offline rows
    DateTimeOffset CreatedAt,
    DateTimeOffset? CompletedAt,
    string Mode = "qa");                           // "qa" | "teach" | "concise" — lets the UI badge teach answers durably

// Story 1.9 / UX-DR16 + Story 2.6 / FR15: coach follow-up cap state. `CapReached`
// is server-computed (single source of truth — the frontend never re-derives it).
// `Scope` tells the frontend which UX-DR16 grammar to render:
//   "analysis"  → free tier, per-analysis: "{used} of {limit} follow-ups · this analysis"
//   "month"     → pro tier, pooled monthly: "{used} of {limit} this month" (resets `ResetsAt`)
//   "unlimited" → credits/unlimited: no chip / "unlimited" copy
// `ResetsAt` is the UTC instant the pooled allowance resets (first of next month);
// null for the per-analysis and unlimited scopes. Both fields are additive — older
// clients that read only Used/Limit/CapReached keep working.
public sealed record CoachCapsDto(
    int Used,
    int Limit,
    bool CapReached,
    string Scope = "analysis",
    DateTimeOffset? ResetsAt = null);

public sealed record CoachConversationDto(
    Guid ConversationId,
    Guid AnalysisId,
    IReadOnlyList<CoachMessageDto> Messages,
    CoachCapsDto Caps);

// `Mode` (story: teach-mode-coach, extended adhoc-concise) is optional —
// absent/unknown binds to "qa" so every existing caller keeps working.
// "teach" puts the coach in teach mode for this turn (lesson grounded in the
// track); "concise" applies a terse style overlay on the same grounded
// prompt (short, one-fact answers) rather than direct Q&A.
public sealed record CreateCoachMessageRequest(string Content, string? Mode = null);

public sealed record CreateCoachMessageResponse(
    Guid ConversationId,
    Guid UserMessageId,
    Guid PendingAssistantMessageId,
    CoachCapsDto Caps);
