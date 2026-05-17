using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

// Per-user overlay on a verdict (dismiss / applied / feedback / user-modified fix).
// Composite primary key (verdict_id, user_id).

[Table("verdict_user_state")]
public sealed class VerdictUserState
{
    [Column("verdict_id"), MaxLength(40)]
    public required string VerdictId { get; set; }

    [Column("user_id")]
    public Guid UserId { get; set; }

    [Column("dismissed")]
    public bool Dismissed { get; set; }

    // Producer marked the fix as applied in their DAW (after Apply Preset audition).
    [Column("applied")]
    public bool Applied { get; set; }

    // User-modified version of the fix (after tweaking on Listen). Optional.
    [Column("user_modified_fix", TypeName = "jsonb")]
    public string? UserModifiedFix { get; set; }

    [Column("feedback"), MaxLength(20)]
    public string? Feedback { get; set; }    // helpful | wrong | unclear

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    [Column("updated_at")]
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
