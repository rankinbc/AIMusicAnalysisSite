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

public sealed record CoachConversationDto(
    Guid ConversationId,
    Guid AnalysisId,
    IReadOnlyList<CoachMessageDto> Messages);

public sealed record CreateCoachMessageRequest(string Content);

public sealed record CreateCoachMessageResponse(
    Guid ConversationId,
    Guid UserMessageId,
    Guid PendingAssistantMessageId);
