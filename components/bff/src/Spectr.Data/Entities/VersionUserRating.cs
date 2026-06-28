using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

[Table("version_user_ratings")]
public sealed class VersionUserRating
{
    [Column("id")] public Guid Id { get; set; } = Guid.NewGuid();
    [Column("user_id")] public Guid UserId { get; set; }
    [Column("version_id")] public Guid VersionId { get; set; }
    [Column("score")] public int Score { get; set; }            // 0..100
    [Column("updated_at")] public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
