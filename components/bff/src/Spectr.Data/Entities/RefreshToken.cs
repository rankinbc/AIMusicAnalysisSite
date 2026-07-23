using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

[Table("refresh_tokens")]
public sealed class RefreshToken
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Column("user_id")]
    public Guid UserId { get; set; }

    [Column("token_hash"), MaxLength(128)]
    public required string TokenHash { get; set; }    // SHA-256 of the cookie value

    [Column("expires_at")]
    public DateTimeOffset ExpiresAt { get; set; }

    [Column("revoked_at")]
    public DateTimeOffset? RevokedAt { get; set; }

    // Set ONLY by rotation — points at the successor row. Logout/reset revocations
    // leave this null, which is what excludes them from the rotation grace window.
    [Column("replaced_by_id")]
    public Guid? ReplacedById { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
