using System.Text.Json;

namespace Spectr.Bff.DTOs;

// Owner-side: open/toggle/revoke share-link.
public sealed record CreateShareResponse(
    string ShareToken,
    bool ShareShowVerdicts,
    DateTimeOffset ShareEnabledAt,
    string PublicUrl);                  // e.g. "/r/<token>" — relative to frontend origin

public sealed record PatchShareRequest(bool ShowVerdicts);

// Public share payload returned to anonymous reviewers. Strips any owner-only
// fields (verdict user state, raw file paths, etc.); the consumer only sees
// what the owner explicitly opted to share.
public sealed record SharedAnalysisDto(
    string Token,
    string? SongName,
    string? ProducerHandle,
    string? ProducerDisplayName,
    DateTimeOffset CreatedAt,
    JsonElement FinalJson,
    // Verdicts list when show_verdicts=true, otherwise null.
    JsonElement? Verdicts);

// One timestamp-pin comment on the shared review.
public sealed record ShareCommentDto(
    Guid Id,
    string? AuthorDisplayName,
    double? TimestampSeconds,
    string Body,
    DateTimeOffset CreatedAt);

public sealed record PostShareCommentRequest(
    string Body,
    double? TimestampSeconds,
    string? AuthorDisplayName);
