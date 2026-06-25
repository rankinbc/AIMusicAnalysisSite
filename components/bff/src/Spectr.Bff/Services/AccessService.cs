using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Spectr.Bff.DTOs;
using Spectr.Data;

namespace Spectr.Bff.Services;

// Listen V3 (PRP-2) — resolves (version, actor) → AccessDto: which Listen MODES
// (Work/View/Room) and capabilities an actor has. Mirrors EntitlementService:
// pure read, 60s cache, flags via EntitlementService.GetFlagsAsync.
//
// INVARIANTS (tested): CanWork and CoachAvailable are owner-only (X.2 / X.1) —
// never true for a non-owner. Room policy resolves through feature_flags +
// EntitlementService tier (no hardcoded tiers).
//
// Cache (G4): per-(version, actor) 60s entry. A monotonic per-version generation
// counter folds into the key, so an owner settings/invite write (which calls
// Invalidate) bumps the generation and instantly orphans every stale actor entry
// for that version — precise invalidation without prefix scanning.
public sealed class AccessService(
    AppDbContext db,
    EntitlementService entitlements,
    IMemoryCache cache)
{
    private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(60);

    public async Task<AccessDto> ResolveAsync(
        Guid versionId, Guid? userId, bool viaValidToken, CancellationToken ct)
    {
        var actorKey = userId is Guid u ? $"u:{u:N}" : "anon";
        var tokenKey = viaValidToken ? "tok" : "notok";
        var cacheKey = $"access:{versionId:N}:{actorKey}:{tokenKey}:{Generation(versionId)}";
        if (cache.TryGetValue(cacheKey, out AccessDto? cached) && cached is not null)
            return cached;

        var dto = await ComputeAsync(versionId, userId, viaValidToken, ct);
        cache.Set(cacheKey, dto, new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = CacheTtl,
        });
        return dto;
    }

    /// <summary>
    /// Live session authority (PRP-4) — host_id + active control_grants. NOT
    /// cached: grant/revoke changes must take effect on the very next action, so
    /// transport/rack/visuals gating always reads fresh. Cheap (one session
    /// projection + the active-grant set, which is tiny — ≤2 rows by the
    /// partial-unique index).
    /// </summary>
    public async Task<SessionRoleDto> ResolveSessionRoleAsync(
        Guid sessionId, Guid? userId, string? anonId, CancellationToken ct)
    {
        var hostId = await db.ListeningSessions.AsNoTracking()
            .Where(s => s.Id == sessionId)
            .Select(s => (Guid?)s.HostId)
            .FirstOrDefaultAsync(ct);
        var isHost = hostId is Guid h && userId is Guid u && h == u;

        var grants = await db.ControlGrants.AsNoTracking()
            .Where(g => g.SessionId == sessionId && g.RevokedAt == null)
            .Select(g => new { g.Scope, g.GranteeUserId, g.GranteeAnonId })
            .ToListAsync(ct);

        bool Holds(string scope) => isHost || grants.Any(g => g.Scope == scope
            && ((userId is Guid gu && g.GranteeUserId == gu)
                || (anonId is not null && g.GranteeAnonId == anonId)));

        return new SessionRoleDto(isHost, Holds("rack"), Holds("visuals"));
    }

    /// <summary>Bump the version's cache generation — call after any owner
    /// settings/invite write so stale (version, actor) entries are orphaned.</summary>
    public void Invalidate(Guid versionId)
    {
        var key = GenerationKey(versionId);
        var next = (cache.TryGetValue(key, out int cur) ? cur : 0) + 1;
        cache.Set(key, next, new MemoryCacheEntryOptions { Priority = CacheItemPriority.NeverRemove });
    }

    private static string GenerationKey(Guid versionId) => $"access_gen:{versionId:N}";

    private int Generation(Guid versionId) =>
        cache.TryGetValue(GenerationKey(versionId), out int gen) ? gen : 0;

    private async Task<AccessDto> ComputeAsync(
        Guid versionId, Guid? userId, bool viaValidToken, CancellationToken ct)
    {
        var ownerId = await (
            from v in db.SongVersions.AsNoTracking()
            join s in db.Songs.AsNoTracking() on v.SongId equals s.Id
            where v.Id == versionId
            select (Guid?)s.UserId).FirstOrDefaultAsync(ct);

        // Version doesn't exist → no access (closed by default).
        if (ownerId is null)
            return new AccessDto("none", false, false, false, false, false,
                new GatesDto(false, false, false));

        var settings = await db.ShareSettings.AsNoTracking()
            .FirstOrDefaultAsync(x => x.SongVersionId == versionId, ct);
        var visibility = settings?.Visibility ?? "private";

        var isOwner = userId is Guid uid && ownerId == uid;
        var isInvited = !isOwner && userId is Guid uid2 && await db.Invites.AsNoTracking()
            .AnyAsync(i => i.SongVersionId == versionId
                && i.InvitedUserId == uid2
                && (i.Status == "pending" || i.Status == "accepted"), ct);

        var role = isOwner ? "owner"
            : isInvited ? "invited"
            : (userId is null && viaValidToken) ? "anon"
            : "none";

        // X.2 — Work is owner-only.
        var canWork = isOwner;
        // An accepted/pending invite is itself the grant — it grants View
        // regardless of visibility (named-reviewer sharing must not require the
        // version to also be unlisted/public). Visibility gates only link/public
        // access. (Refines the PRP pseudocode, which nested invited under
        // visibility!=private; that would force a visibility flip per invite.)
        var canView = isOwner
            || isInvited
            || (visibility != "private" && (visibility == "public" || viaValidToken));

        // Gates. 'named' comments require an account (D4.4); 'link' permits anon.
        var commentsPolicy = settings?.CommentsPolicy ?? "link";
        var canComment = canView && commentsPolicy != "off"
            && (commentsPolicy == "link" || userId is not null);
        var canSuggest = canView && (settings?.SuggestionsAllowed ?? true);
        var canBookmark = canView && (settings?.BookmarkingAllowed ?? true);

        // Room policy via feature_flags + tier (Δ5). At launch room_hosting_enabled
        // is false → RoomHostable is false for everyone (admin-only Rooms).
        var flags = await entitlements.GetFlagsAsync(ct);
        var hostingEnabled = flags.TryGetValue("room_hosting_enabled", out var he)
            && string.Equals(he, "true", StringComparison.OrdinalIgnoreCase);
        var minTier = flags.TryGetValue("room_host_min_tier", out var mt) ? mt : "pro";
        var actorTier = userId is Guid uid3
            ? (await entitlements.ForAsync(uid3, ct)).Tier
            : "anon";
        var hostPolicy = settings?.SessionHostPolicy ?? "owner_only";
        var roomHostable = (isOwner || (isInvited && hostPolicy == "invited"))
            && hostingEnabled
            && TierRank(actorTier) >= TierRank(minTier);

        var joinPolicy = settings?.SessionJoinPolicy ?? "link";
        var roomJoinable = canView
            && (isOwner || isInvited || joinPolicy == "public"
                || (joinPolicy == "link" && viaValidToken));

        // X.1 — coach is owner-only, never granted to a non-owner.
        var coachAvailable = isOwner;

        return new AccessDto(role, canWork, canView, roomHostable, roomJoinable,
            coachAvailable, new GatesDto(canComment, canSuggest, canBookmark));
    }

    // free < credits < pro. anon/unknown ranks below free so it never satisfies a min-tier gate.
    private static int TierRank(string tier) => tier switch
    {
        "pro" => 2,
        "credits" => 1,
        "free" => 0,
        _ => -1,
    };
}
