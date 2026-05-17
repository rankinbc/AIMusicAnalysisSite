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

// PATCH /api/versions/{id}
public sealed record PatchVersionRequest(string? Label);

// POST /api/versions/{id}/analyze
public sealed record ReanalyzeResponse(Guid JobId);

// Session notes — pinned per-time annotations on a version, private to the
// owner. `TSeconds` is the playhead position; UI renders pins on the scrubber.
public sealed record NoteDto(
    Guid Id,
    Guid VersionId,
    double TSeconds,
    string Text,
    bool Pinned,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record CreateNoteRequest(double TSeconds, string Text, bool Pinned);

public sealed record PatchNoteRequest(double? TSeconds, string? Text, bool? Pinned);

// Per-stem upload — role labels match `audio_analysis.stems.types.StemRole`.
public sealed record StemUploadResponse(
    Guid VersionId,
    Dictionary<string, string> StemPaths,
    Guid ReanalysisJobId);

public sealed record AlsUploadResponse(Guid VersionId, string AlsPath, Guid ReanalysisJobId);
