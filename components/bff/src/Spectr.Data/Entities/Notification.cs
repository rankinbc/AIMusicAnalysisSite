using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

/// <summary>
/// Story 11.6 — a recorded thing-that-happened for a user's inbox.
///
/// Two row shapes share the table:
///  - EVENT rows (digest_key NULL): one row per occurrence.
///  - DIGEST rows (digest_key set): one rolling row per
///    (recipient, digestType, version, UTC day) with an incrementing count
///    (bookmarks). Uniqueness is enforced by a RAW-SQL partial unique index
///    on digest_key WHERE digest_key IS NOT NULL (EF can't express it
///    fluently — appended manually in the migration, same pattern as the
///    is_current index; see bff/README.md).
/// </summary>
[Table("notifications")]
public sealed class Notification
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    // Recipient is ALWAYS a signed-in user — anon recipients are a sink no-op.
    [Column("recipient_user_id")]
    public required Guid RecipientUserId { get; set; }

    [Column("event_type"), MaxLength(64)]
    public required string EventType { get; set; }

    // Emitter-provided context (commentId/versionId/suggestionId/actor…).
    [Column("payload", TypeName = "jsonb")]
    public string? PayloadJson { get; set; }

    // "{recipientUserId}:{digestType}:{versionId}:{yyyy-MM-dd}" — NULL for event rows.
    [Column("digest_key"), MaxLength(200)]
    public string? DigestKey { get; set; }

    // 1 for event rows; rolling occurrence count for digest rows.
    [Column("count")]
    public int Count { get; set; } = 1;

    [Column("read_at")]
    public DateTimeOffset? ReadAt { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    // Inbox sort key: digest upserts bump this; event rows keep it = created_at.
    [Column("updated_at")]
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
