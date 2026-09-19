namespace Spectr.Bff.DTOs;

// Anon-capable actor projection (authed user OR anon). Hue drives avatar color.
// Split out of the deleted FeedbackDtos.cs (solo strip, task 8) — ActorProjection
// (Services/ActorProjection.cs) still needs this record. A later task removes it
// once nothing references it.
public sealed record ActorRefDto(
    string Type,           // "user" | "anon"
    Guid? UserId,
    string? Handle,
    string? DisplayName,
    int? Hue);
