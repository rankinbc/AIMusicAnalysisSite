namespace Spectr.Bff.Services;

/// <summary>Who an actor is: a signed-in user or a durable anonymous client.</summary>
public enum ActorType
{
    User,
    Anon,
}

/// <summary>
/// The shared actor value type used across Listen V3 (PRP-0…7). Mirrors the
/// frontend <c>ActorRef</c>: a user (by id) or a durable anon (by signed cookie
/// <c>anonId</c> — NOT an ip_hash). Dedup/attribution downstream keys on
/// <see cref="ActorKey"/> so user and anon ids can never collide.
/// </summary>
public sealed record ActorRef(
    ActorType Type,
    Guid? UserId = null,
    string? AnonId = null,
    string? Handle = null,
    string? DisplayName = null,
    int? Hue = null)
{
    public static ActorRef User(Guid userId, string? handle = null) =>
        new(ActorType.User, UserId: userId, Handle: handle);

    public static ActorRef Anon(string anonId, string? displayName = null) =>
        new(ActorType.Anon, AnonId: anonId, DisplayName: displayName);

    /// <summary>
    /// Stable, type-prefixed key for dedup + rate limiting. A user and an anon
    /// with coincidentally-equal raw ids never share a key.
    /// </summary>
    public string ActorKey => Type == ActorType.User
        ? $"user:{UserId}"
        : $"anon:{AnonId}";
}
