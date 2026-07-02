using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

/// <summary>
/// Story 11.9 — the follow graph edge. Uniqueness on (follower_id,
/// followee_id) makes Follow idempotent; self-follows are rejected at the
/// endpoint AND by a CHECK constraint. Both FKs cascade so deleting a user
/// cleans their edges in both directions.
/// </summary>
[Table("follow_relations")]
public sealed class FollowRelation
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Column("follower_id")]
    public required Guid FollowerId { get; set; }

    [Column("followee_id")]
    public required Guid FolloweeId { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
