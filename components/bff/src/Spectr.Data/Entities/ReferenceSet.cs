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
