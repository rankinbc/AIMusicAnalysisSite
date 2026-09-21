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
    string Mode = "qa",                            // "qa" | "teach" | "concise" | "brief"
    // Task G3: badges the coach's once-per-conversation opening brief so the
    // UI can render it distinctly. `ClosingLine` is set ONLY at read time —
    // never stored on the row — and only for a guest caller viewing a
    // completed brief, so a converted user stops seeing it and the demo
    // snapshot exporter (which reads the same row) never bakes it in.
    bool IsBrief = false,
    string? ClosingLine = null);

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

// Task G3 — the coach's once-per-conversation opening brief. The BFF writes
// a server-authored trigger row (never shown, never counted) through the
// SAME coach_reply actor in a new "brief" mode; POST is idempotent under
// concurrency via a partial unique index on (conversation_id) WHERE
// mode='brief' AND role='assistant'.
//   "created" (202) — this call inserted the pair and enqueued coach_reply.
//   "exists"  (200) — a brief already exists (this call or a race loser);
//                     MessageId is the existing assistant row, nothing enqueued.
//   "skipped" (200) — the version is the seeded demo track; MessageId is null.
public sealed record CoachBriefResponse(string Status, Guid? MessageId);

public static class CoachBrief
{
    public const string Mode = "brief";
    // Fixed system trigger — never producer text, never shown, never billed.
    public const string Instruction = "Give me your opening brief for this mix.";
    // Exact copy per the controller's ruling — deterministic, never LLM-generated.
    public const string GuestClosingLine =
        "Create a free account and let's save our progress — so we can make this mix awesome.";
}
