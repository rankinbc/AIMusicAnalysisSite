namespace Spectr.Bff.DTOs;

public sealed record VersionMetricsDto(
    double? Score,
    double? Lufs,
    double? DynamicRangeLu,
    double? Bass,
    double? Air,
    double? StereoWidth);

public sealed record VersionDto(
    Guid Id,
    Guid SongId,
    int VersionNumber,
    string? Label,
    bool IsCurrent,
    string FilePath,
    DateTimeOffset CreatedAt,
    string? AlsFilePath = null,
    string? ReferencePath = null,
    VersionMetricsDto? LatestResult = null,
    int? PersonalScore = null,
    // The newest COMPLETED analysis for THIS version. An `analyses` row is 1:1
    // with a successful job (Entities/Analysis.cs), so a row means "completed"
    // and no status join is needed. Populated by GET /api/versions/{id} ONLY —
    // the Listen page resolves the playing version's findings through it and
    // must never fall back to the SONG's latest analysis, which can belong to
    // a different version.
    Guid? LatestJobId = null);

// GET /api/versions/{id}/files — metadata for all files attached to a version.
// `Available` is false when the file has been deleted / expired from storage.
// `StemId` is set only for type="stem" and is used to build the download path.
public sealed record VersionFileEntry(
    string Type,
    string Filename,
    long? SizeBytes,
    bool Available,
    string? StemId = null);

// POST /api/reports/{jobId}/phases/{phase}/rerun — id of the lightweight re-run
// job to poll; the re-run updates the existing analysis in place.
public sealed record RerunPhaseResponse(Guid JobId);

// Optional body for a phase re-run override.
// - ReferenceProfile: phase-6 only — compare against a chosen profile.
//   kind "user" → setId (aggregate embedded by the server); kind "genre" → preset.
// - GenreHint: phase-2 only (item 1) — a user genre CORRECTION. The server
//   cascades the rerun across phases 2/3/5/6 (every genre-reading phase) and
//   refreshes rule-engine findings; see ReportPhaseEndpoints.RerunPhase.
public sealed record RerunPhaseRequest(ReferenceProfileRef? ReferenceProfile, string? GenreHint);
public sealed record ReferenceProfileRef(string Kind, Guid? SetId, string? Preset);

public sealed record VersionFilesResponse(Guid VersionId, List<VersionFileEntry> Files);

// JobId is null when the upload deferred analysis (unified-upload flow uses
// analyze=false on the mix, then dispatches a single job downstream).
public sealed record UploadResponse(Guid SongId, Guid VersionId, Guid? JobId);

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

// ReanalysisJobId is null when the .als was attached with analyze=false.
public sealed record AlsUploadResponse(Guid VersionId, string AlsPath, Guid? ReanalysisJobId);

// ── Bulk stem upload (drag-drop up to 100, audio-content auto-classification) ──
// One staged stem as surfaced to the confirm UI (camelCase over the wire).
public sealed record StemRawDto(
    string Id,
    string OriginalFilename,
    string? DetectedRole,
    double Confidence,
    string? Evidence,
    string? ConfirmedRole);

public sealed record StageStemsResponse(Guid VersionId, List<StemRawDto> Stems);

// classified=true once every staged stem has a detected_role (worker finished).
public sealed record StemProposalsResponse(Guid VersionId, bool Classified, List<StemRawDto> Stems);

public sealed record ConfirmStemItem(string Id, string ConfirmedRole);

// mode: "grouped" (default) | "per_stem"
// referenceId: optional saved library reference to drive Phase 5.
public sealed record ConfirmStemsRequest(List<ConfirmStemItem> Stems, string? Mode, Guid? ReferenceId = null);

public sealed record ConfirmStemsResponse(Guid VersionId, Guid ReanalysisJobId);
