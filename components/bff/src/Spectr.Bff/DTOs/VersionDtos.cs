namespace Spectr.Bff.DTOs;

public sealed record VersionDto(
    Guid Id,
    Guid SongId,
    int VersionNumber,
    string? Label,
    bool IsCurrent,
    string FilePath,
    DateTimeOffset CreatedAt);

public sealed record UploadResponse(Guid SongId, Guid VersionId, Guid JobId);
