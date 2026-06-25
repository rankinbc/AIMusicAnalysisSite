using System.Text.Json;

namespace Spectr.Bff.DTOs;

// Listen V3 (PRP-3) — View feedback DTOs: threaded comments + reviewer suggestions.

// Anon-capable actor projection (authed user OR anon). Hue drives avatar color.
public sealed record ActorRefDto(
    string Type,           // "user" | "anon"
    Guid? UserId,
    string? Handle,
    string? DisplayName,
    int? Hue);

public sealed record CommentDto(
    Guid Id,
    Guid TargetVersionId,
    Guid? ParentId,
    double? T,             // timestamp_seconds; null = general comment
    ActorRefDto Author,
    string Body,
    string Status,
    Guid? SuggestionId,
    DateTimeOffset CreatedAt);

// AuthorDisplayName is only honored for anon authors (authed uses the profile).
public sealed record PostCommentRequest(
    Guid? ParentId,
    double? T,
    string Body,
    string? AuthorDisplayName);

public sealed record PatchCommentStatusRequest(string Status);

public sealed record SuggestionDto(
    Guid Id,
    Guid SongVersionId,
    ActorRefDto FromActor,
    JsonElement Chain,
    Guid? CommentId,
    Guid? CreatedInSessionId,
    string Status,
    DateTimeOffset CreatedAt);

public sealed record CreateSuggestionRequest(
    Guid? CommentId,
    JsonElement Chain,
    string? FromDisplayName);   // anon proposer display name
