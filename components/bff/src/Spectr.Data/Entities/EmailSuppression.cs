using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

/// <summary>
/// Story 4.2 (AR27/NFR25) — addresses we must never email again.
/// Appended by the Resend bounce/complaint webhook; checked by
/// QueueEmailSender at enqueue time. Email is stored LOWERCASE (PK).
/// Rows are never deleted automatically — a complaint is a complaint.
/// </summary>
[Table("email_suppressions")]
public sealed class EmailSuppression
{
    [Key]
    [Column("email"), MaxLength(320)]
    public required string Email { get; set; }

    // "bounced" | "complained"
    [Column("reason"), MaxLength(32)]
    public required string Reason { get; set; }

    // Resend/svix event id that caused the suppression (audit trail).
    [Column("source_event_id"), MaxLength(64)]
    public string? SourceEventId { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
