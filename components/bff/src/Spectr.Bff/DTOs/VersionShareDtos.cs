namespace Spectr.Bff.DTOs;

// Listen V3 (PRP-2) — version-scoped sharing DTOs. A SEPARATE file from the
// analysis-share DTOs (ShareDtos.cs), which stay intact (additive discipline).

// Owner's gate bundle (1:1 with a version). ShareToken is null while private.
public sealed record ShareSettingsDto(
    Guid VersionId,
    string Visibility,
    string? ShareToken,
    bool ShowVerdicts,
    string CommentsPolicy,
    bool SuggestionsAllowed,
    bool BookmarkingAllowed,
    string SessionHostPolicy,
    string SessionJoinPolicy,
    DateTimeOffset? EnabledAt);

// PUT — every field optional (partial update). Leaving 'private' lazily mints a token.
public sealed record UpdateShareSettingsRequest(
    string? Visibility,
    bool? ShowVerdicts,
    string? CommentsPolicy,
    bool? SuggestionsAllowed,
    bool? BookmarkingAllowed,
    string? SessionHostPolicy,
    string? SessionJoinPolicy);

public sealed record RotateTokenResponse(string ShareToken);

// The resolution contract the Work/View/Room switcher reads.
public sealed record GatesDto(bool CanComment, bool CanSuggest, bool CanBookmark);

public sealed record AccessDto(
    string Role,           // owner | invited | anon | none
    bool CanWork,          // owner only (X.2)
    bool CanView,
    bool RoomHostable,     // owner||invited(host_policy) AND room_hosting_enabled AND tier>=min
    bool RoomJoinable,
    bool CoachAvailable,   // owner only (X.1)
    GatesDto Gates);

public sealed record InviteDto(
    Guid Id,
    string Scope,
    Guid? SongVersionId,
    string Role,
    string Status,
    string? InvitedEmail,
    string? InvitedHandle,
    string Token,
    DateTimeOffset CreatedAt,
    DateTimeOffset? AcceptedAt);

public sealed record CreateInviteRequest(
    string Role,
    string? InvitedEmail,
    string? InvitedHandle);

// Anonymous View entry (GET /v/{token}) — version + current-analysis summary + anon gates.
// OwnerHandle/OwnerDisplayName (story 11.11): public identity of the track owner
// for the post-claim "follow this producer" CTA — same exposure as /u/{handle};
// null when the owner has no handle or is inactive.
public sealed record VersionViewDto(
    Guid VersionId,
    string SongName,
    int VersionNumber,
    string Visibility,
    bool ShowVerdicts,
    string? Grade,
    int? Score,
    GatesDto Gates,
    string? OwnerHandle,
    string? OwnerDisplayName);
