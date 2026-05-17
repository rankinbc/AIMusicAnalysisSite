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
    string? ShareToken);

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
