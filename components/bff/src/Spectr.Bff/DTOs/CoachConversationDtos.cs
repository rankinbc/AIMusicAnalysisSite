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
    DateTimeOffset? CompletedAt);

// Story 1.9 / UX-DR16: per-analysis follow-up cap state. `CapReached` is
// server-computed (single source of truth — if the formula changes in
// story 2.6 we don't have a frontend that disagrees). The free-tier
// specialization of UX-DR16 grammar `{used} of {limit} follow-ups · this
// analysis` is owned by the frontend; story 2.6 will add `Tier` / `ResetsAt`
// fields for the Pro-per-month form.
public sealed record CoachCapsDto(int Used, int Limit, bool CapReached);

public sealed record CoachConversationDto(
    Guid ConversationId,
    Guid AnalysisId,
    IReadOnlyList<CoachMessageDto> Messages,
    CoachCapsDto Caps);

public sealed record CreateCoachMessageRequest(string Content);

public sealed record CreateCoachMessageResponse(
    Guid ConversationId,
    Guid UserMessageId,
    Guid PendingAssistantMessageId,
    CoachCapsDto Caps);
