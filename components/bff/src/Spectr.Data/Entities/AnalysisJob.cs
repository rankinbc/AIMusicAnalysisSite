using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

// Transient runtime state for an in-flight (or recently-completed) analysis.
// On COMPLETE, the worker inserts an Analysis row and the job becomes a
// historical record. UI reads phase_pct / current_phase from here during
// processing; once done, switches to Analysis.

[Table("analysis_jobs")]
public sealed class AnalysisJob
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Column("user_id")]
    public Guid UserId { get; set; }

    // Nullable: ad-hoc upload that hasn't been saved to library yet
    [Column("version_id")]
    public Guid? VersionId { get; set; }

    [Column("status"), MaxLength(32)]
    public string Status { get; set; } = "pending";   // pending|processing|complete|failed|awaiting_stem_mapping

    [Column("current_phase"), MaxLength(64)]
    public string CurrentPhase { get; set; } = "";

    [Column("phase_pct")]
    public double PhasePct { get; set; }

    // Reference saved-library entry used (if any). Drives reference_tracks.used_count.
    [Column("reference_id")]
    public Guid? ReferenceId { get; set; }

    [Column("task_id"), MaxLength(255)]
    public string? TaskId { get; set; }

    [Column("error_message")]
    public string? ErrorMessage { get; set; }

    // Story 2.3 / AC3 — typed error code so the BFF can fire a
    // credit-reversal entry idempotently when the worker fails a job
    // pre-pipeline due to an invalid file. Worker writes
    // `error_code = "invalid_file"` (or any future typed-failure key);
    // the BFF's GET /api/jobs/{id} hook observes it and calls
    // CreditLedgerService.ReverseAsync. Nullable for back-compat with
    // existing rows + successful jobs.
    [Column("error_code"), MaxLength(64)]
    public string? ErrorCode { get; set; }

    // Story 2.4 — tier stamped at dispatch time so the worker never reads billing tables.
    [Column("tier"), MaxLength(16)]
    public string? Tier { get; set; }

    [Column("dispatched_at")]
    public DateTimeOffset DispatchedAt { get; set; } = DateTimeOffset.UtcNow;

    [Column("started_at")]
    public DateTimeOffset? StartedAt { get; set; }

    [Column("completed_at")]
    public DateTimeOffset? CompletedAt { get; set; }

    [Column("failed_at")]
    public DateTimeOffset? FailedAt { get; set; }
}
