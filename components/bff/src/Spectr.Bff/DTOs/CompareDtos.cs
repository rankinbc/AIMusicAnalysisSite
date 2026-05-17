namespace Spectr.Bff.DTOs;

// One side of a comparison. The frontend renders both A and B with the
// delta computed client-side; the server keeps this DTO purely descriptive
// so adding/removing metrics doesn't churn the diff math.

public sealed record CompareSideDto(
    Guid VersionId,
    int VersionNumber,
    string? Label,
    DateTimeOffset CreatedAt,
    string? Grade,
    double? Score,
    // Phase 1 numerics (LUFS, true-peak, dynamic range, stereo) flattened to
    // keep the DTO ergonomic on the React side.
    double? Lufs,
    double? TruePeakDb,
    double? RmsDb,
    double? Bpm,
    string? DetectedKey,
    double? StereoWidth,
    double? StereoCorrelation,
    double? MonoCompatibility,
    // Per-band frequency level (Phase 1 bands dict in raw form).
    Dictionary<string, double>? Bands);

// Compare two versions of the same song. `Source` describes how the data
// was derived (analysis vs. fresh compute) for cache invalidation purposes.
public sealed record CompareResponseDto(
    Guid SongId,
    CompareSideDto A,
    CompareSideDto B,
    string Source);
