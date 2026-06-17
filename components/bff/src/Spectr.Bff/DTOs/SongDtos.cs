namespace Spectr.Bff.DTOs;

public sealed record TagDto(Guid Id, string Name, bool IsPublic);

public sealed record SongDto(
    Guid Id,
    string Name,
    string? GenreHint,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? ArchivedAt,
    IReadOnlyList<VersionDto> Versions,
    AnalysisSummaryDto? LatestResult,
    IReadOnlyList<TagDto> Tags);

public sealed record CreateSongRequest(string Name, string? GenreHint);
public sealed record PatchSongRequest(string? Name, string? GenreHint);

public sealed record CreateTagRequest(string Name, bool IsPublic);

public sealed record AnalysisSummaryDto(
    Guid Id,
    Guid JobId,
    DateTimeOffset CreatedAt,
    string? Grade,
    double? Score);

// ── Reports list ─────────────────────────────────────────────────────────────

public sealed record ReportListItemDto(
    Guid JobId,
    Guid? VersionId,
    int? VersionNumber,
    string? VersionLabel,
    Guid? SongId,
    string? SongName,
    string? GenreHint,
    string Status,
    string? Grade,
    double? Score,
    IReadOnlyList<TagDto> Tags,
    DateTimeOffset DispatchedAt,
    DateTimeOffset? CompletedAt);

public sealed record ReportListResponse(
    IReadOnlyList<ReportListItemDto> Items,
    int Total,
    int Page,
    int PageSize);
