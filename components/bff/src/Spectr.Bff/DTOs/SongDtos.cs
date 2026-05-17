namespace Spectr.Bff.DTOs;

public sealed record SongDto(
    Guid Id,
    string Name,
    string? GenreHint,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? ArchivedAt,
    IReadOnlyList<VersionDto> Versions,
    AnalysisSummaryDto? LatestResult);

public sealed record CreateSongRequest(string Name, string? GenreHint);
public sealed record PatchSongRequest(string? Name, string? GenreHint);

public sealed record AnalysisSummaryDto(
    Guid Id,
    Guid JobId,
    DateTimeOffset CreatedAt,
    string? Grade,
    double? Score);
