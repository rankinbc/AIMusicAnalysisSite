using System.Text.Json;

namespace Spectr.Bff.DTOs;

// Producer's saved reference tracks. The DB stores `tags` + `band_levels` as
// raw JSONB strings; the API surfaces them as JsonElement so the frontend
// doesn't need to re-parse strings inside its JSON.

public sealed record ReferenceDto(
    Guid Id,
    string Title,
    string? Artist,
    string Source,                // "file" | "youtube" | "spotify" | …
    string? FilePath,
    string? Genre,
    double? Bpm,
    string? DetectedKey,
    double? DurationSeconds,
    double? Lufs,
    double? TruePeakDb,
    double? DynamicRangeLu,
    double? StereoWidth,
    double? StereoCorrelation,
    JsonElement? BandLevels,
    JsonElement Tags,
    bool Analyzed,
    string AnalysisStatus,        // "pending" | "analyzed" | "failed"
    string? AnalysisError,        // short reason when failed
    int UsedCount,
    string? Notes,
    DateTimeOffset CreatedAt,
    IReadOnlyList<Guid> SetIds);

public sealed record PatchReferenceRequest(
    string? Title,
    string? Artist,
    string? Genre,
    string? Notes,
    JsonElement? Tags);

public sealed record ReferenceSetDto(
    Guid Id,
    string Name,
    short? Hue,
    int MemberCount,
    int AnalyzedCount,
    DateTimeOffset CreatedAt);

public sealed record CreateReferenceSetRequest(string Name, short? Hue);

public sealed record PatchReferenceSetRequest(string? Name, short? Hue);

public sealed record AddReferenceToSetRequest(Guid ReferenceId);

// Compact member row for the profile detail view.
public sealed record ReferenceSummaryDto(
    Guid Id,
    string Title,
    string? Artist,
    string AnalysisStatus,
    string? AnalysisError);

// GET /reference-sets/{id} — the set + its lazily-refreshed aggregate + members.
public sealed record ReferenceSetDetailDto(
    Guid Id,
    string Name,
    short? Hue,
    int MemberCount,
    int AnalyzedCount,
    JsonElement? ProfileJson,
    IReadOnlyList<ReferenceSummaryDto> Members,
    DateTimeOffset CreatedAt);

// POST /references/analyze — bulk analyze by id.
public sealed record BatchAnalyzeRequest(IReadOnlyList<Guid> Ids);
