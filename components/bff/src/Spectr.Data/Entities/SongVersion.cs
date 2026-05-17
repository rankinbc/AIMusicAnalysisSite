using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

[Table("song_versions")]
public sealed class SongVersion
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Column("song_id")]
    public Guid SongId { get; set; }

    [Column("version_number")]
    public int VersionNumber { get; set; }

    [Column("label"), MaxLength(120)]
    public string? Label { get; set; }

    [Column("notes")]
    public string? Notes { get; set; }

    [Column("file_path"), MaxLength(500)]
    public required string FilePath { get; set; }

    [Column("reference_path"), MaxLength(500)]
    public string? ReferencePath { get; set; }

    [Column("als_file_path"), MaxLength(500)]
    public string? AlsFilePath { get; set; }

    [Column("stem_paths_raw", TypeName = "jsonb")]
    public string? StemPathsRaw { get; set; }

    [Column("stem_paths", TypeName = "jsonb")]
    public string? StemPaths { get; set; }

    [Column("is_current")]
    public bool IsCurrent { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    [Column("updated_at")]
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
