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

    // ── Library-redesign metadata (TEXT columns; no polymorphic FKs) ──────────
    [Column("description"), MaxLength(500)]
    public string? Description { get; set; }

    // One of: aurora, vinyl, spin, eq, skyline, robot, booth, cassette, boombox.
    [Column("visual_template"), MaxLength(16)]
    public string? VisualTemplate { get; set; }

    // Serialized oklch(l c h).
    [Column("visual_primary"), MaxLength(40)]
    public string? VisualPrimary { get; set; }

    [Column("visual_secondary"), MaxLength(40)]
    public string? VisualSecondary { get; set; }

    // 'set' (reference_profile_id is a reference-set id) or 'preset' (a genre key).
    [Column("reference_profile_kind"), MaxLength(8)]
    public string? ReferenceProfileKind { get; set; }

    // Free-form string: a reference-set id (kind=set) OR a genre key (kind=preset).
    [Column("reference_profile_id"), MaxLength(64)]
    public string? ReferenceProfileId { get; set; }

    [Column("archived_at")]
    public DateTimeOffset? ArchivedAt { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    [Column("updated_at")]
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
