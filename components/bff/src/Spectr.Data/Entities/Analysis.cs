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
    // Story 4.5 (AR24): nullable — anonymous reports own device_id instead
    // (DB CHECK exactly-one).
    [Column("user_id")]
    public Guid? UserId { get; set; }

    [Column("device_id"), MaxLength(26)]
    public string? DeviceId { get; set; }

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

    // ── Version stamps (v3 closeout, 2026-07-23) ───────────────────────────
    // Ops-facing provenance: which code produced this row. Written by the
    // Python worker at persist time; nullable so historical rows stay valid.
    // pipeline_version   = audio_analysis.ANALYSIS_SCHEMA_VERSION (e.g. "2.1.0")
    // rule_engine_version = verdict_lib RULE_ENGINE_VERSION ("rule_engine@1.0.0")
    // validator_version  = verdict_lib VALIDATOR_VERSION ("validator@1.0.0")
    // prompt_set_version = comma-joined "<slug>@<ver>" of every prompt on disk
    [Column("pipeline_version"), MaxLength(40)]
    public string? PipelineVersion { get; set; }

    [Column("rule_engine_version"), MaxLength(60)]
    public string? RuleEngineVersion { get; set; }

    [Column("validator_version"), MaxLength(60)]
    public string? ValidatorVersion { get; set; }

    [Column("prompt_set_version"), MaxLength(2000)]
    public string? PromptSetVersion { get; set; }

    // Small map for the Results "Analysis pipeline" timeline. Shape:
    //   { "decode": 1240, "loudness": 820, "spectrum": 1480, ... }
    [Column("phase_durations", TypeName = "jsonb")]
    public string PhaseDurations { get; set; } = "{}";

    // Pointer (storage key) to the audiowaveform-generated peaks JSON.
    [Column("waveform_peaks_path"), MaxLength(500)]
    public string? WaveformPeaksPath { get; set; }

    // Storage keys for the server-rendered result images (WebP), written by the
    // worker's analyze_audio_job. Null when rendering was unavailable/failed.
    // Served by GET /api/jobs/{jobId}/images/{kind}.
    [Column("spectrogram_image_path"), MaxLength(500)]
    public string? SpectrogramImagePath { get; set; }

    [Column("waveform_image_path"), MaxLength(500)]
    public string? WaveformImagePath { get; set; }

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

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
