using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

// Cached output of a Compare(track_version, reference) computation. Both sides
// are immutable analyses, so the cache key is the pair itself. Invalidated
// only when one side is re-analyzed (cascade delete via FK).

[Table("compare_cache")]
public sealed class CompareCache
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Column("user_id")]
    public Guid UserId { get; set; }

    [Column("track_version_id")]
    public Guid TrackVersionId { get; set; }

    [Column("reference_id")]
    public Guid ReferenceId { get; set; }

    [Column("match_score")]
    public int MatchScore { get; set; }    // 0–100 weighted L2 distance

    // Per-dimension breakdown: { loudness: 82, frequency: 64, stereo: 76, dynamics: 71 }
    [Column("sub_scores", TypeName = "jsonb")]
    public string SubScores { get; set; } = "{}";

    // Delta rows: [{ metric: "lufs", yours: -11.2, theirs: -9.2, delta: -2.0 }, ...]
    [Column("delta_metrics", TypeName = "jsonb")]
    public string DeltaMetrics { get; set; } = "[]";

    // Templated suggestions: [{ category, title, detail }, ...]
    [Column("suggestions", TypeName = "jsonb")]
    public string Suggestions { get; set; } = "[]";

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
