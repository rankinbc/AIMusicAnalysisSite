using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

/// <summary>
/// Story 4.5 (AR24) — an anonymous browser identity. Created on the first
/// anonymous analysis; referenced by the signed httpOnly `spectr_device`
/// cookie. Jobs/reports/conversations own `device_id` XOR `user_id`
/// (DB CHECK). Claim (AR25) re-parents the rows and stamps claimed_*;
/// unclaimed devices and their rows purge after 72 h (worker sweep).
/// ip_hash/ua_hash are SHA-256 peppered digests — raw IP/UA never stored.
/// </summary>
[Table("devices")]
public sealed class Device
{
    // ULID (26-char Crockford base32) — sortable, no coordination.
    [Key]
    [Column("id"), MaxLength(26)]
    public required string Id { get; set; }

    [Column("ip_hash"), MaxLength(64)]
    public required string IpHash { get; set; }

    [Column("ua_hash"), MaxLength(64)]
    public required string UaHash { get; set; }

    [Column("claimed_by_user_id")]
    public Guid? ClaimedByUserId { get; set; }

    [Column("claimed_at")]
    public DateTimeOffset? ClaimedAt { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
