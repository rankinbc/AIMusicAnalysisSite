using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

// Story 1.5 / AR9 / AR10: one row per turn in a coach conversation.
// `role="user"` rows are written by the BFF inline on POST. `role="assistant"`
// rows are written by the BFF in status="pending" on the same POST and
// updated by the `coach_reply` Python actor when the LLM call completes.
//
// `evidence` is the JSON list of citation chips that survived resolution
// against the context bundle (unresolvable paths dropped, per AR10).
// `refusal_reason` is set on assistant rows that returned a structured
// refusal: "missing_data", "out_of_scope", "injection_attempt", or the
// coach-offline marker "coach_offline" written on LlmBudgetExceeded.

[Table("coach_messages")]
public sealed class CoachMessage
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Column("conversation_id")]
    public Guid ConversationId { get; set; }

    [Column("role"), MaxLength(16)]
    public required string Role { get; set; }            // "user" | "assistant"

    [Column("status"), MaxLength(16)]
    public string Status { get; set; } = "complete";    // "pending" | "complete" | "refused" | "error"

    [Column("content")]
    public string Content { get; set; } = "";

    // Resolved evidence chips (assistant rows; null on user rows). Shape:
    //   [{"label": "LUFS -11.2", "path": "phase1.lufs_integrated"}, ...]
    [Column("evidence", TypeName = "jsonb")]
    public string? Evidence { get; set; }

    [Column("refusal_reason"), MaxLength(64)]
    public string? RefusalReason { get; set; }

    // ULID of the matching llm_calls row (assistant rows that hit the LLM).
    // Null for user rows AND for assistant rows that short-circuited without
    // a gateway call (e.g. coach_offline when the analysis was already
    // degraded, or LlmBudgetExceeded — the row is un-metered in that case).
    [Column("llm_call_id"), MaxLength(40)]
    public string? LlmCallId { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    [Column("completed_at")]
    public DateTimeOffset? CompletedAt { get; set; }
}
