using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

[Table("reference_sets")]
public sealed class ReferenceSet
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Column("user_id")]
    public Guid UserId { get; set; }

    [Column("name"), MaxLength(120)]
    public required string Name { get; set; }

    [Column("hue")]
    public short? Hue { get; set; }

    // Cached aggregate over analyzed members (mean±std per metric) in the exact
    // statistical-profile shape phase 6 consumes. Lazily recomputed when
    // ProfileFingerprint drifts. Nullable until first computed.
    [Column("profile_json", TypeName = "jsonb")]
    public string? ProfileJson { get; set; }

    [Column("profile_fingerprint"), MaxLength(64)]
    public string? ProfileFingerprint { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

[Table("reference_set_members")]
public sealed class ReferenceSetMember
{
    [Column("set_id")]
    public Guid SetId { get; set; }

    [Column("reference_id")]
    public Guid ReferenceId { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
