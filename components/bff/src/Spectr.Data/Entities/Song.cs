using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

[Table("songs")]
public sealed class Song
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Column("user_id")]
    public Guid UserId { get; set; }

    [Column("name"), MaxLength(200)]
    public required string Name { get; set; }

    [Column("genre_hint"), MaxLength(50)]
    public string? GenreHint { get; set; }

    [Column("default_reference_id")]
    public Guid? DefaultReferenceId { get; set; }

    [Column("archived_at")]
    public DateTimeOffset? ArchivedAt { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    [Column("updated_at")]
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
