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
    IReadOnlyList<TagDto> Tags,
    string Visibility,
    string? Description,
    string? VisualTemplate,
    string? VisualPrimary,
    string? VisualSecondary,
    string? ReferenceProfileKind,
    string? ReferenceProfileId);

public sealed record CreateSongRequest(
    string Name,
    string? GenreHint,
    string? Description = null,
    string? VisualTemplate = null,
    string? VisualPrimary = null,
    string? VisualSecondary = null,
    string? ReferenceProfileKind = null,
    string? ReferenceProfileId = null);

public sealed record PatchSongRequest(
    string? Name,
    string? GenreHint,
    string? Visibility = null,
    string? Description = null,
    string? VisualTemplate = null,
    string? VisualPrimary = null,
    string? VisualSecondary = null,
    string? ReferenceProfileKind = null,
    string? ReferenceProfileId = null);

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
