namespace Spectr.Bff.DTOs;

// Bookmarks point at either a share token (anonymous, share-link review) or
// a published track ID (Discover feed; not active in v1). Returned with the
// resolved target metadata so the UI doesn't need a second round-trip.

public sealed record BookmarkDto(
    Guid Id,
    string? TargetShareToken,
    Guid? TargetPublishedTrack,
    string? Title,                // resolved from Analysis/Song when token set
    string? Artist,               // ditto — owner's display_name or handle
    DateTimeOffset CreatedAt);

public sealed record CreateBookmarkRequest(
    string? TargetShareToken,
    Guid? TargetPublishedTrack);
