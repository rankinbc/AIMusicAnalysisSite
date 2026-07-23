using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Security.Claims;
using System.Security.Cryptography;

namespace Spectr.Bff.Endpoints;

// Listen V3 (PRP-2) — owner-side version sharing: gate settings, token mint/rotate,
// invites CRUD/accept, and the authed GET /access resolver. ADDITIVE — the
// analysis-scoped share path (ShareEndpoints) is untouched.
public static class VersionShareEndpoints
{
    private static readonly HashSet<string> Visibilities = new() { "private", "unlisted", "public" };
    private static readonly HashSet<string> CommentsPolicies = new() { "off", "link", "named" };
    private static readonly HashSet<string> HostPolicies = new() { "owner_only", "invited" };
    private static readonly HashSet<string> JoinPolicies = new() { "invited", "link", "public" };
    private static readonly HashSet<string> InviteRoles = new() { "reviewer", "listener", "host" };

    public static IEndpointRouteBuilder MapVersionShareEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/versions/{versionId:guid}").WithTags("version-share").RequireAuthorization();
        g.MapGet("/share", GetSettings);
        g.MapPut("/share", UpdateSettings);
        g.MapPost("/share/rotate", RotateToken);
        g.MapGet("/access", GetAccess);
        g.MapGet("/view", GetView);
        g.MapPost("/invites", CreateInvite);
        g.MapGet("/invites", ListInvites);

        var inv = app.MapGroup("/invites").WithTags("version-share").RequireAuthorization();
        inv.MapDelete("/{inviteId:guid}", RevokeInvite);
        inv.MapPost("/{token}/accept", AcceptInvite);
        return app;
    }

    // Tracked ownership probe (NOT AsNoTracking — keeps write paths safe + uniform).
    private static Task<bool> OwnsVersion(AppDbContext db, Guid versionId, Guid userId, CancellationToken ct) =>
        (from v in db.SongVersions
         join s in db.Songs on v.SongId equals s.Id
         where v.Id == versionId && s.UserId == userId
         select v.Id).AnyAsync(ct);

    // Same recipe as ShareEndpoints.GenerateToken (24 random bytes, url-safe base64,
    // trim '='). Replicated because that one is private + ShareEndpoints is frozen.
    private static string GenerateToken()
    {
        var buf = RandomNumberGenerator.GetBytes(24);
        return Convert.ToBase64String(buf).Replace('+', '-').Replace('/', '_').TrimEnd('=');
    }

    private static ShareSettingsDto ToDto(Guid versionId, ShareSetting? s) =>
        s is null
            ? new ShareSettingsDto(versionId, "private", null, false, "link", true, true,
                "owner_only", "link", null)
            : new ShareSettingsDto(versionId, s.Visibility, s.ShareToken, s.ShowVerdicts,
                s.CommentsPolicy, s.SuggestionsAllowed, s.BookmarkingAllowed,
                s.SessionHostPolicy, s.SessionJoinPolicy, s.EnabledAt);

    private static InviteDto ToInviteDto(Invite i) => new(
        i.Id, i.Scope, i.SongVersionId, i.Role, i.Status, i.InvitedEmail, i.InvitedHandle,
        i.Token, i.CreatedAt, i.AcceptedAt);

    // ── Settings ─────────────────────────────────────────────────────────────
    private static async Task<IResult> GetSettings(
        Guid versionId, ClaimsPrincipal currentUser, AppDbContext db, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        if (!await OwnsVersion(db, versionId, userId, ct)) return Results.NotFound();
        var s = await db.ShareSettings.AsNoTracking().FirstOrDefaultAsync(x => x.SongVersionId == versionId, ct);
        return Results.Ok(ToDto(versionId, s));
    }

    private static async Task<IResult> UpdateSettings(
        Guid versionId, UpdateShareSettingsRequest body, ClaimsPrincipal currentUser,
        AppDbContext db, AccessService access, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        if (!await OwnsVersion(db, versionId, userId, ct)) return Results.NotFound();

        // Validate any supplied enum before mutating.
        if (body.Visibility is { } vis && !Visibilities.Contains(vis))
            return Results.BadRequest(new { error = "Invalid visibility." });
        if (body.CommentsPolicy is { } cp && !CommentsPolicies.Contains(cp))
            return Results.BadRequest(new { error = "Invalid comments_policy." });
        if (body.SessionHostPolicy is { } hp && !HostPolicies.Contains(hp))
            return Results.BadRequest(new { error = "Invalid session_host_policy." });
        if (body.SessionJoinPolicy is { } jp && !JoinPolicies.Contains(jp))
            return Results.BadRequest(new { error = "Invalid session_join_policy." });

        var s = await db.ShareSettings.FirstOrDefaultAsync(x => x.SongVersionId == versionId, ct);
        if (s is null)
        {
            s = new ShareSetting { SongVersionId = versionId };
            db.ShareSettings.Add(s);
        }

        if (body.Visibility is not null) s.Visibility = body.Visibility;
        if (body.ShowVerdicts is not null) s.ShowVerdicts = body.ShowVerdicts.Value;
        if (body.CommentsPolicy is not null) s.CommentsPolicy = body.CommentsPolicy;
        if (body.SuggestionsAllowed is not null) s.SuggestionsAllowed = body.SuggestionsAllowed.Value;
        if (body.BookmarkingAllowed is not null) s.BookmarkingAllowed = body.BookmarkingAllowed.Value;
        if (body.SessionHostPolicy is not null) s.SessionHostPolicy = body.SessionHostPolicy;
        if (body.SessionJoinPolicy is not null) s.SessionJoinPolicy = body.SessionJoinPolicy;

        // Mint the token lazily — only once visibility leaves 'private'.
        if (s.Visibility != "private" && string.IsNullOrEmpty(s.ShareToken))
        {
            s.ShareToken = GenerateToken();
            s.EnabledAt = DateTimeOffset.UtcNow;
        }
        s.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        access.Invalidate(versionId);
        return Results.Ok(ToDto(versionId, s));
    }

    private static async Task<IResult> RotateToken(
        Guid versionId, ClaimsPrincipal currentUser, AppDbContext db, AccessService access, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        if (!await OwnsVersion(db, versionId, userId, ct)) return Results.NotFound();
        var s = await db.ShareSettings.FirstOrDefaultAsync(x => x.SongVersionId == versionId, ct);
        if (s is null || s.Visibility == "private")
            return Results.BadRequest(new { error = "Sharing is not enabled for this version." });

        s.ShareToken = GenerateToken();   // mints new, invalidates the old
        s.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        access.Invalidate(versionId);
        return Results.Ok(new RotateTokenResponse(s.ShareToken));
    }

    // ── Access (any authed actor) ────────────────────────────────────────────
    private static async Task<IResult> GetAccess(
        Guid versionId, ClaimsPrincipal currentUser, AccessService access, CancellationToken ct)
    {
        var dto = await access.ResolveAsync(versionId, currentUser.UserId(), viaValidToken: false, ct);
        return Results.Ok(dto);
    }

    // GET /api/versions/{id}/view — authed by-id twin of GET /v/{token}
    // (VersionViewEndpoints). Invited/link/public viewers land on
    // /listen-rack/{versionId} (invite accept, room join) where the owner-scoped
    // GET /versions/{id} 404s for them; this is their version-metadata surface.
    // Same VersionViewDto, gated by AccessService.CanView instead of a token.
    private static async Task<IResult> GetView(
        Guid versionId, ClaimsPrincipal currentUser, AccessService access,
        AppDbContext db, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var acc = await access.ResolveAsync(versionId, userId, viaValidToken: false, ct);
        if (!acc.CanView) return Results.NotFound();

        var info = await (
            from v in db.SongVersions.AsNoTracking()
            join s in db.Songs.AsNoTracking() on v.SongId equals s.Id
            join u in db.Users.AsNoTracking() on s.UserId equals u.Id
            where v.Id == versionId
            select new
            {
                v.VersionNumber,
                SongName = s.Name,
                OwnerHandle = u.IsActive ? u.Handle : null,
                OwnerDisplayName = u.IsActive ? u.DisplayName : null,
            }).FirstOrDefaultAsync(ct);
        if (info is null) return Results.NotFound();

        var settings = await db.ShareSettings.AsNoTracking()
            .FirstOrDefaultAsync(x => x.SongVersionId == versionId, ct);

        return Results.Ok(new VersionViewDto(
            versionId, info.SongName, info.VersionNumber,
            settings?.Visibility ?? "private",
            settings?.ShowVerdicts ?? false,
            Grade: null, Score: null,
            acc.Gates,
            info.OwnerHandle, info.OwnerDisplayName));
    }

    // ── Invites ──────────────────────────────────────────────────────────────
    private static async Task<IResult> CreateInvite(
        Guid versionId, CreateInviteRequest body, ClaimsPrincipal currentUser,
        AppDbContext db, AccessService access, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        if (!await OwnsVersion(db, versionId, userId, ct)) return Results.NotFound();
        var role = (body?.Role ?? "").ToLowerInvariant();
        if (!InviteRoles.Contains(role))
            return Results.BadRequest(new { error = "Invalid role (reviewer|listener|host)." });

        var handle = string.IsNullOrWhiteSpace(body!.InvitedHandle) ? null : body.InvitedHandle!.Trim();
        var email = string.IsNullOrWhiteSpace(body.InvitedEmail) ? null : body.InvitedEmail!.Trim();

        // Bind invited_user_id eagerly when the handle/email maps to an existing
        // account, so AccessService grants the invitee access without an explicit
        // accept (pending counts). Unknown invitees bind on accept via the token.
        Guid? invitedUserId = null;
        if (handle is not null)
            invitedUserId = await db.Users.Where(u => u.Handle == handle).Select(u => (Guid?)u.Id).FirstOrDefaultAsync(ct);
        if (invitedUserId is null && email is not null)
            invitedUserId = await db.Users.Where(u => u.Email == email).Select(u => (Guid?)u.Id).FirstOrDefaultAsync(ct);

        var invite = new Invite
        {
            Id = Guid.NewGuid(),
            Scope = "version",
            SongVersionId = versionId,
            Role = role,
            Token = GenerateToken(),
            Status = "pending",
            CreatedBy = userId,
            InvitedUserId = invitedUserId,
            InvitedEmail = email,
            InvitedHandle = handle,
        };
        db.Invites.Add(invite);
        await db.SaveChangesAsync(ct);
        access.Invalidate(versionId);
        return Results.Created($"/api/invites/{invite.Id}", ToInviteDto(invite));
    }

    private static async Task<IResult> ListInvites(
        Guid versionId, ClaimsPrincipal currentUser, AppDbContext db, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        if (!await OwnsVersion(db, versionId, userId, ct)) return Results.NotFound();
        var rows = await db.Invites.AsNoTracking()
            .Where(i => i.SongVersionId == versionId)
            .OrderByDescending(i => i.CreatedAt)
            .ToListAsync(ct);
        return Results.Ok(rows.Select(ToInviteDto).ToList());
    }

    private static async Task<IResult> RevokeInvite(
        Guid inviteId, ClaimsPrincipal currentUser, AppDbContext db, AccessService access, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var invite = await db.Invites.FirstOrDefaultAsync(i => i.Id == inviteId, ct);
        if (invite?.SongVersionId is not Guid vid) return Results.NotFound();
        if (!await OwnsVersion(db, vid, userId, ct)) return Results.NotFound();

        invite.Status = "revoked";
        await db.SaveChangesAsync(ct);
        access.Invalidate(vid);
        return Results.NoContent();
    }

    // Accept binds the logged-in user + flips status. Any authed user with the token.
    private static async Task<IResult> AcceptInvite(
        string token, ClaimsPrincipal currentUser, AppDbContext db, AccessService access, CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var invite = await db.Invites.FirstOrDefaultAsync(i => i.Token == token, ct);
        if (invite is null || invite.Status == "revoked") return Results.NotFound();

        invite.InvitedUserId = userId;
        invite.Status = "accepted";
        invite.AcceptedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        if (invite.SongVersionId is Guid vid) access.Invalidate(vid);
        return Results.Ok(ToInviteDto(invite));
    }
}
