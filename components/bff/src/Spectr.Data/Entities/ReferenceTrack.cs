using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

// Producer's saved reference tracks — commercial mixes used as comparison
// targets on the Compare page. Each gets analyzed once (via the reference-mode
// pipeline runner) and its summary metrics live inline here for fast reads.
//
// Table name "reference_tracks" — "references" is a reserved word in some
// SQL dialects.

[Table("reference_tracks")]
public sealed class ReferenceTrack
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Column("user_id")]
    public Guid UserId { get; set; }

    [Column("title"), MaxLength(200)]
    public required string Title { get; set; }

    [Column("artist"), MaxLength(120)]
    public string? Artist { get; set; }

    // 'file' in v1. URL-based ingestion (youtube|spotify|soundcloud) defers to Phase 2.5.
    [Column("source"), MaxLength(20)]
    public string Source { get; set; } = "file";

    [Column("source_url"), MaxLength(500)]
    public string? SourceUrl { get; set; }

    [Column("file_path"), MaxLength(500)]
    public string? FilePath { get; set; }

    [Column("genre"), MaxLength(50)]
    public string? Genre { get; set; }

    [Column("bpm")]
    public double? Bpm { get; set; }

    [Column("detected_key"), MaxLength(10)]
    public string? DetectedKey { get; set; }

    [Column("duration_seconds")]
    public double? DurationSeconds { get; set; }

    [Column("lufs")]
    public double? Lufs { get; set; }

    [Column("true_peak_db")]
    public double? TruePeakDb { get; set; }

    [Column("dynamic_range_lu")]
    public double? DynamicRangeLu { get; set; }

    [Column("stereo_width")]
    public double? StereoWidth { get; set; }

    [Column("stereo_correlation")]
    public double? StereoCorrelation { get; set; }

    // 8-band frequency curve for Compare overlay. Shape: [0.62, 0.88, 0.71, ...]
    [Column("band_levels", TypeName = "jsonb")]
    public string? BandLevels { get; set; }

    [Column("tags", TypeName = "jsonb")]
    public string Tags { get; set; } = "[]";

    [Column("analyzed")]
    public bool Analyzed { get; set; }

    // Per-reference analyze lifecycle. "analyzed" bool stays in sync (true iff
    // status == "analyzed") for the aggregation filter's back-compat.
    [Column("analysis_status"), MaxLength(16)]
    public string AnalysisStatus { get; set; } = "pending";  // pending | analyzed | failed

    [Column("analysis_error")]
    public string? AnalysisError { get; set; }

    [Column("used_count")]
    public int UsedCount { get; set; }

    [Column("notes")]
    public string? Notes { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
