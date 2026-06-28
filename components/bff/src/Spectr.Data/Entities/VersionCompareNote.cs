using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

[Table("version_compare_notes")]
public sealed class VersionCompareNote
{
    [Column("id")] public Guid Id { get; set; } = Guid.NewGuid();
    [Column("user_id")] public Guid UserId { get; set; }
    [Column("song_id")] public Guid SongId { get; set; }
    // Normalized: version_a_id < version_b_id (Guid ordinal) so A↔B is one row.
    [Column("version_a_id")] public Guid VersionAId { get; set; }
    [Column("version_b_id")] public Guid VersionBId { get; set; }
    [Column("body")] public string Body { get; set; } = "";
    [Column("updated_at")] public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
