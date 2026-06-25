using System.Security.Claims;
using Spectr.Bff.Auth;

namespace Spectr.Bff.Services;

/// <summary>A resource an opaque token resolved to (e.g. a share token → versionId).</summary>
public sealed record ResolvedResource(string Kind, Guid ResourceId);

/// <summary>The actor (authed or anon) + the resource an opaque token resolved to.</summary>
public sealed record ResourceActor(ActorRef Actor, ResolvedResource Resource);

/// <summary>
/// Pluggable opaque-token resolver. PRP-2 ships a ShareTokenResolver
/// (token → share_settings → versionId); PRP-4 a SessionTokenResolver. Register
/// implementations in DI; <see cref="ResourceTokenAuth"/> dispatches by
/// <see cref="Kind"/>.
/// </summary>
public interface ITokenResolver
{
    string Kind { get; }

    Task<ResolvedResource?> ResolveAsync(string token, CancellationToken ct = default);
}

/// <summary>
/// Resolves an opaque RESOURCE token (share/session) carried in the path or body —
/// explicitly NOT the JwtBearer <c>?t=</c> pipeline (that stays whitelisted to
/// <c>/api/versions/{id}/audio</c> and only ever accepts a valid JWT). The actor is
/// the authed JWT principal when present, else the durable anon identity. This
/// keeps opaque tokens off the JWT path (PRP-2 G1) — the seam PRP-2/4 extend.
/// </summary>
public sealed class ResourceTokenAuth
{
    private readonly IReadOnlyList<ITokenResolver> _resolvers;
    private readonly AnonIdentity _anon;

    public ResourceTokenAuth(IEnumerable<ITokenResolver> resolvers, AnonIdentity anon)
    {
        _resolvers = resolvers.ToList();
        _anon = anon;
    }

    /// <summary>
    /// Resolve an opaque token of <paramref name="kind"/> and attach the actor.
    /// Returns null when no resolver matches the kind or the token doesn't resolve
    /// (caller maps null → 404).
    /// </summary>
    public async Task<ResourceActor?> ResolveAsync(
        string kind, string? token, ClaimsPrincipal user, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;

        var resolver = _resolvers.FirstOrDefault(r =>
            string.Equals(r.Kind, kind, StringComparison.Ordinal));
        if (resolver is null) return null;

        var resource = await resolver.ResolveAsync(token, ct);
        if (resource is null) return null;

        var actor = (user.Identity?.IsAuthenticated ?? false)
            ? ActorRef.User(user.UserId())
            : _anon.Capture();
        return new ResourceActor(actor, resource);
    }
}
