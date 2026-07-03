using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

/// <summary>
/// Story 4.3 — single-use, expiring auth tokens (email verification +
/// password reset). Mirrors the RefreshToken shape: the RAW token (32 RNG
/// bytes, base64url) rides only in the emailed link; only its SHA-256 hex
/// lands here. Consumption is an atomic UPDATE ... WHERE consumed_at IS NULL
/// (no read-then-write race). Purpose keeps one table polymorphic.
/// </summary>
[Table("auth_tokens")]
public sealed class AuthToken
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Column("user_id")]
    public required Guid UserId { get; set; }

    // "verify_email" | "reset_password"
    [Column("purpose"), MaxLength(32)]
    public required string Purpose { get; set; }

    [Column("token_hash"), MaxLength(128)]
    public required string TokenHash { get; set; }

    [Column("expires_at")]
    public required DateTimeOffset ExpiresAt { get; set; }

    [Column("consumed_at")]
    public DateTimeOffset? ConsumedAt { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
