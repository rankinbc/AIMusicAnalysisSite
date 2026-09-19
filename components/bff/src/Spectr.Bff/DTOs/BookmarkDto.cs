namespace Spectr.Bff.DTOs;

// Split out of the deleted BookmarkDtos.cs (solo strip, task 8) — the anon
// share-link view flow (Endpoints/VersionViewEndpoints.cs, out of this task's
// scope: it's owned by sharing, a later task) still creates + returns bookmarks
// via the /v/{token}/bookmark route. Mirrors the ActorRefDto/FeedbackDtos.cs
// split called out in the task brief. A later task removes this once the
// sharing/view surface is deleted too.
//
// Bookmarks point at a share token (anonymous, share-link review) or a song
// VERSION, optionally at a moment (t) + with a note. Returned with the
// resolved target metadata so the UI doesn't need a second round-trip.
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

// Anon create via /v/{token}/bookmark — the token resolves the version; anon is
// never identity-visible (D5.4), so only the moment + note are accepted.
public sealed record AnonBookmarkRequest(double? T, string? Note);
