using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

// One row per completed analysis (1:1 with successful AnalysisJob).
// Owner/song denormalized for fast list queries.

[Table("analyses")]
public sealed class Analysis
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Column("job_id")]
    public Guid JobId { get; set; }

    // Denormalized for IDOR-safe list queries (avoid 3-table join on every list).
    [Column("user_id")]
    public Guid UserId { get; set; }

    // Nullable: ad-hoc analyses not saved to library don't have a version yet.
    [Column("version_id")]
    public Guid? VersionId { get; set; }

    [Column("song_id")]
    public Guid? SongId { get; set; }

    [Column("song_name"), MaxLength(200)]
    public string? SongName { get; set; }

    // The big synthesized output — every pipeline phase serializes into this.
    [Column("final_json", TypeName = "jsonb")]
    public string FinalJson { get; set; } = "{}";

    // Small map for the Results "Analysis pipeline" timeline. Shape:
    //   { "decode": 1240, "loudness": 820, "spectrum": 1480, ... }
    [Column("phase_durations", TypeName = "jsonb")]
    public string PhaseDurations { get; set; } = "{}";

    // Pointer (storage key) to the audiowaveform-generated peaks JSON.
    [Column("waveform_peaks_path"), MaxLength(500)]
    public string? WaveformPeaksPath { get; set; }

    // Per-stem analysis output (only present when stems were uploaded).
    [Column("stem_metrics", TypeName = "jsonb")]
    public string? StemMetrics { get; set; }

    // Triage routing plan: `{specialists_to_run, skip, rationale,
    // estimated_total_tokens}`. Written by the `run_triage` Python actor on
    // first ListVerdicts call. Null until generated.
    [Column("routing_plan", TypeName = "jsonb")]
    public string? RoutingPlan { get; set; }

    // Story 1.4 / FR16: machine-readable degradation notice stamped by the
    // worker when the per-tier monthly budget is blown, the operator's
    // global hard cap is hit, or the provider-outage circuit breaker opens.
    // Shape: `{ "reason": "tier_budget|global_budget|circuit_breaker",
    //          "detail": "...", "occurred_at": "<ISO-8601 UTC>" }`.
    // Null on a healthy report. First failure wins (never overwritten).
    [Column("degradation_notice", TypeName = "jsonb")]
    public string? DegradationNotice { get; set; }

    // ── Sharing ────────────────────────────────────────────────────────────
    // Token is null until producer enables sharing. Generated lazily.
    [Column("share_token"), MaxLength(36)]
    public string? ShareToken { get; set; }

    [Column("share_show_verdicts")]
    public bool ShareShowVerdicts { get; set; }

    [Column("share_enabled_at")]
    public DateTimeOffset? ShareEnabledAt { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
