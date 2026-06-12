using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

// Operator-controlled prompt-version pin (FR48). One row per specialist slug;
// a NULL/absent pin means "serve the live prompt file's frontmatter version".
// The Python worker's prompt loader reads this table (TTL-cached) so flipping
// a row rolls a prompt back without redeploy. Written by the operator (raw
// SQL until the Epic 10 admin endpoints land); the worker only reads.

[Table("prompt_versions")]
public sealed class PromptVersion
{
    [Key]
    [Column("slug"), MaxLength(64)]
    public required string Slug { get; set; }

    [Column("pinned_version"), MaxLength(32)]
    public string? PinnedVersion { get; set; }

    [Column("updated_at")]
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
