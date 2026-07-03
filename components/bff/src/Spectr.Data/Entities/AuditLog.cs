using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

/// <summary>
/// Story 4.6 (AC4) — append-only audit trail. First writer: account
/// deletion (action = "account_delete", actor = the user). Story 10.5
/// extends with admin actions (refunds, bans, flag changes) — the shape
/// here matches its (actor, target, reason, timestamp) contract. Rows are
/// never updated or deleted; actor_user_id is NOT FK'd (the audited actor
/// may be the row being deleted).
/// </summary>
[Table("audit_log")]
public sealed class AuditLog
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Column("actor_user_id")]
    public required Guid ActorUserId { get; set; }

    // "account_delete" | 10.5 adds: "refund", "ban", "flag_change", ...
    [Column("action"), MaxLength(64)]
    public required string Action { get; set; }

    // What was acted on — for account_delete this is the user id again.
    [Column("target"), MaxLength(200)]
    public required string Target { get; set; }

    [Column("reason"), MaxLength(500)]
    public string? Reason { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
