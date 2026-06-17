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
    DateTimeOffset CreatedAt);

public sealed record CreateReferenceSetRequest(string Name, short? Hue);

public sealed record PatchReferenceSetRequest(string? Name, short? Hue);

public sealed record AddReferenceToSetRequest(Guid ReferenceId);
