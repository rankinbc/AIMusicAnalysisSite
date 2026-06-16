using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

[Table("feature_flags")]
public sealed class FeatureFlag
{
    [Column("name"), Key, MaxLength(128)]
    public string Name { get; set; } = "";

    [Column("value")]
    public string Value { get; set; } = "";

    [Column("updated_at")]
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
