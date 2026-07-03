using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

// Story 1.5 / AR9: one conversation per (analysis, user) pair. The BFF
// get-or-creates this row on the first POST to /coach/{analysisId}/messages.
// All CoachMessages hang off this row; per-analysis coach caps (story 1.9)
// will count rows in coach_messages joined on conversation_id.

[Table("conversations")]
public sealed class Conversation
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Column("analysis_id")]
    public Guid AnalysisId { get; set; }

    // Story 4.5 (AR24): nullable — anonymous conversations own device_id
    // instead (DB CHECK exactly-one).
    [Column("user_id")]
    public Guid? UserId { get; set; }

    [Column("device_id"), MaxLength(26)]
    public string? DeviceId { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
