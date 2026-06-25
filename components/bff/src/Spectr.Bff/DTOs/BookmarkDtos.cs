namespace Spectr.Bff.DTOs;

// Bookmarks point at a share token (anonymous, share-link review), a published
// track ID (Discover; not active in v1), or — Listen V3 (PRP-6) — a song VERSION,
// optionally at a moment (t) + with a note. Returned with the resolved target
// metadata so the UI doesn't need a second round-trip.

public sealed record BookmarkDto(
    Guid Id,
    string? TargetShareToken,
    Guid? TargetPublishedTrack,
    Guid? TargetVersionId,        // PRP-6 version target
    double? T,                    // timestamp_seconds; null = whole-version bookmark
    string? Note,
    bool IdentityVisible,         // D5.4 — named bookmarker opted into author visibility
    string? Title,                // resolved from Analysis/Song when token set
    string? Artist,               // ditto — owner's display_name or handle
    DateTimeOffset CreatedAt);

// Authed create — exactly one target. T/Note/IdentityVisible apply to version targets.
public sealed record CreateBookmarkRequest(
    string? TargetShareToken,
    Guid? TargetPublishedTrack,
    Guid? TargetVersionId,
    double? T,
    string? Note,
    bool IdentityVisible = false);

// Anon create via /v/{token}/bookmark — the token resolves the version; anon is
// never identity-visible (D5.4), so only the moment + note are accepted.
public sealed record AnonBookmarkRequest(double? T, string? Note);

// Author signal (D5.4, owner-only): aggregate count (incl. anon, anonymously) +
// the subset of NAMED bookmarkers who opted into visibility. Anon never identified.
public sealed record BookmarkSignalDto(int Count, IReadOnlyList<ActorRefDto> Identified);
