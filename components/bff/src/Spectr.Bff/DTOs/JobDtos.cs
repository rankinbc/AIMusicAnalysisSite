using System.Text.Json;

namespace Spectr.Bff.DTOs;

public sealed record JobStatusDto(
    Guid Id,
    string Status,
    string CurrentPhase,
    double PhasePct,
    Guid? VersionId,
    Guid? SongId,
    string? ErrorMessage,
    DateTimeOffset DispatchedAt,
    DateTimeOffset? StartedAt,
    DateTimeOffset? CompletedAt,
    DateTimeOffset? FailedAt);

public sealed record JobResultsDto(
    Guid JobId,
    Guid AnalysisId,
    Guid? VersionId,
    Guid? SongId,
    string? SongName,
    JsonElement FinalJson,
    string? ShareToken,
    // Client-parsed Ableton project map ("project awareness") stored on the
    // version, surfaced for the results Project view. Null when no .als project
    // JSON was uploaded. The worker phase8 parse remains authoritative for analysis.
    JsonElement? AlsProject = null,
    // Authenticated routes for the server-rendered result images. Null when the
    // image wasn't produced. The client appends `?t=<jwt>` for the <img> tag.
    string? SpectrogramImageUrl = null,
    string? WaveformImageUrl = null);

// Story 6.3 — the anon upload/restore response: just the job to poll.
public sealed record AnonAnalysisResponse(Guid JobId);

// Story 6.4 — the device's latest job for the landing resume card. Superset of
// AnonAnalysisResponse (JobId), so /analyze's restore reads JobId and ignores
// the rest. Grade is null unless a completed analysis exists.
public sealed record AnonResumeDto(Guid JobId, string Status, DateTimeOffset DispatchedAt, string? Grade);

// Lightweight summary used by the jobs-list endpoint. Excludes final_json
// (potentially several MB) so the list query stays fast.
public sealed record JobSummaryDto(
    Guid Id,
    string Status,
    string CurrentPhase,
    double PhasePct,
    Guid? VersionId,
    Guid? SongId,
    string? SongName,
    DateTimeOffset DispatchedAt,
    DateTimeOffset? StartedAt,
    DateTimeOffset? CompletedAt,
    DateTimeOffset? FailedAt);
