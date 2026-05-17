namespace Spectr.Bff.DTOs;

// Aggregate counts shown at the top of the profile page. These could be
// derived client-side from the songs list, but counting via SQL avoids
// shipping the whole library to the browser just to count it.
public sealed record MeStatsDto(
    int Songs,
    int Versions,
    int Analyses,
    int ThisMonthAnalyses,
    int Plays);

// One row in the profile/activity feed. Heterogeneous kinds (job-complete,
// analysis-run, song-created) UNIONed into a single time-ordered stream.
public sealed record ActivityItemDto(
    string Kind,                  // "analysis" | "song" | "version"
    string Text,                  // pre-rendered prose for the UI
    DateTimeOffset OccurredAt,
    Guid? SongId,
    Guid? VersionId,
    Guid? JobId);

// Extended profile beyond AuthedUser. Returns the same fields PATCH /me/profile
// accepts so the frontend can do a round-trip without an extra GET.
public sealed record MeProfileDto(
    Guid Id,
    string Email,
    string? Handle,
    string? DisplayName,
    string? Bio,
    short? AvatarHue,
    short? BannerHue,
    string? Accent,
    string? PublicLink);

public sealed record PatchMeProfileRequest(
    string? DisplayName,
    string? Handle,
    string? Bio,
    short? AvatarHue,
    short? BannerHue,
    string? Accent,
    string? PublicLink);
