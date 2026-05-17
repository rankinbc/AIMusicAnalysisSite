using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

[Table("session_notes")]
public sealed class SessionNote
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Column("version_id")]
    public Guid VersionId { get; set; }

    [Column("user_id")]
    public Guid UserId { get; set; }

    [Column("t_seconds")]
    public double TSeconds { get; set; }

    [Column("text")]
    public required string Text { get; set; }

    [Column("pinned")]
    public bool Pinned { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    [Column("updated_at")]
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
