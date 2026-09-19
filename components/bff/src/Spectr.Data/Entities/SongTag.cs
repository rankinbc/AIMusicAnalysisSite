using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

[Table("song_tags")]
public sealed class SongTag
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Column("song_id")]
    public Guid SongId { get; set; }

    [Column("user_id")]
    public Guid UserId { get; set; }

    // Stored as-entered; comparisons use ILike for case-insensitivity.
    [Column("name"), MaxLength(64)]
    public required string Name { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
