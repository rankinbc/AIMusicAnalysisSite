using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Security.Claims;
using System.Text.Json;

namespace Spectr.Bff.Endpoints;

// Listen V3 (PRP-3) — View feedback: threaded comments + reviewer suggestions.
// EVERY route authorizes through AccessService (PRP-2): canView to read,
// gates.canComment to post a comment, gates.canSuggest to propose, owner to
// moderate/accept/reject. Authed actions are version-scoped (/versions/{id});
// anonymous participation (D4.4) goes through the opaque share token (/v/{token},
// resolved via ResourceTokenAuth — off the JWT path). Accept = fork-to-preset,
// reusing PRP-1's RackPreset + the PRP-0 no-op notification / game-plan sinks.
public static class FeedbackEndpoints
{
    private static readonly HashSet<string> CommentStatuses =
        new() { "open", "resolved", "pinned", "hidden" };

    public static IEndpointRouteBuilder MapFeedbackEndpoints(this IEndpointRouteBuilder app)
    {
        var v = app.MapGroup("/versions/{versionId:guid}").WithTags("feedback").RequireAuthorization();
        v.MapGet("/comments", ListCommentsAuthed);
        v.MapPost("/comments", PostCommentAuthed);
        v.MapGet("/suggestions", ListSuggestionsAuthed);
        v.MapPost("/suggestions", PostSuggestionAuthed);

        var c = app.MapGroup("/comments").WithTags("feedback").RequireAuthorization();
        c.MapPatch("/{commentId:guid}", PatchCommentStatus);
        c.MapDelete("/{commentId:guid}", DeleteComment);

        var sg = app.MapGroup("/suggestions").WithTags("feedback").RequireAuthorization();
        sg.MapPost("/{suggestionId:guid}/accept", AcceptSuggestion);
        sg.MapPost("/{suggestionId:guid}/reject", RejectSuggestion);

        var anon = app.MapGroup("/v/{token}").WithTags("feedback").AllowAnonymous();
        anon.MapGet("/comments", ListCommentsAnon);
        anon.MapPost("/comments", PostCommentAnon);
        anon.MapPost("/suggestions", PostSuggestionAnon);
        return app;
    }

    // ── shared helpers ───────────────────────────────────────────────────────
    private static Task<Guid?> VersionOwner(AppDbContext db, Guid versionId, CancellationToken ct) =>
        (from v in db.SongVersions
         join s in db.Songs on v.SongId equals s.Id
         where v.Id == versionId
         select (Guid?)s.UserId).FirstOrDefaultAsync(ct);

    private static JsonElement Parse(string raw)
    {
        using var doc = JsonDocument.Parse(string.IsNullOrEmpty(raw) ? "{}" : raw);
        return doc.RootElement.Clone();
    }

    // Stable FNV-1a hue (0–359) for avatar coloring — deterministic across runs.
    private static int HueFrom(string? key)
    {
        if (string.IsNullOrEmpty(key)) return 210;
        unchecked
        {
            uint h = 2166136261;
            foreach (var ch in key) { h ^= ch; h *= 16777619; }
            return (int)(h % 360);
        }
    }

    private static ActorRefDto ActorOf(Guid? userId, User? u, string? displayName, string? anonId) =>
        userId is Guid uid && u is not null
            ? new ActorRefDto("user", uid, u.Handle, u.DisplayName ?? u.Handle, u.AvatarHue ?? HueFrom(uid.ToString()))
            : new ActorRefDto("anon", null, null, displayName, HueFrom(anonId ?? displayName));

    private static string? Trim(string? s, int cap = 120)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        var t = s.Trim();
        return t.Length > cap ? t[..cap] : t;
    }

    private static async Task<List<CommentDto>> LoadComments(AppDbContext db, Guid versionId, CancellationToken ct)
    {
        var rows = await (
            from cm in db.TrackComments.AsNoTracking()
            where cm.TargetVersionId == versionId && cm.DeletedAt == null
            join usr in db.Users.AsNoTracking() on cm.AuthorUserId equals usr.Id into uj
            from usr in uj.DefaultIfEmpty()
            orderby cm.CreatedAt
            select new { cm, usr }).ToListAsync(ct);

        return rows.Select(r => new CommentDto(
            r.cm.Id, r.cm.TargetVersionId!.Value, r.cm.ParentId, r.cm.TimestampSeconds,
            ActorOf(r.cm.AuthorUserId, r.usr, r.cm.AuthorDisplayName, r.cm.AuthorAnonId),
            r.cm.Body, r.cm.Status, r.cm.SuggestionId, r.cm.CreatedAt)).ToList();
    }

    private static async Task<List<SuggestionDto>> LoadSuggestions(
        AppDbContext db, Guid versionId, bool isOwner, Guid? userId, CancellationToken ct)
    {
        var q = db.Suggestions.AsNoTracking().Where(s => s.SongVersionId == versionId);
        if (!isOwner)
            q = q.Where(s => s.Status == "accepted" || (userId != null && s.FromUserId == userId));

        var rows = await (
            from s in q
            join usr in db.Users.AsNoTracking() on s.FromUserId equals usr.Id into uj
            from usr in uj.DefaultIfEmpty()
            orderby s.CreatedAt descending
            select new { s, usr }).ToListAsync(ct);

        return rows.Select(r => new SuggestionDto(
            r.s.Id, r.s.SongVersionId,
            ActorOf(r.s.FromUserId, r.usr, r.s.FromDisplayName, r.s.FromAnonId),
            Parse(r.s.ChainJson), r.s.CommentId, r.s.CreatedInSessionId, r.s.Status, r.s.CreatedAt)).ToList();
    }

    // Core insert paths — shared by authed + anon routes (actor differs only in id columns).
    private static async Task<IResult> InsertComment(
        AppDbContext db, INotificationSink notif, Guid versionId, AccessDto access,
        Guid? userId, string? anonId, PostCommentRequest body, CancellationToken ct)
    {
        if (!access.Gates.CanComment)
            return ErrorEnvelope.Build(403, "comment_forbidden", "Commenting isn't allowed here.");
        var text = (body?.Body ?? "").Trim();
        if (string.IsNullOrEmpty(text)) return Results.BadRequest(new { error = "Body is required." });
        if (text.Length > 2000) return Results.BadRequest(new { error = "Body exceeds 2000 chars." });

        if (body!.ParentId is Guid pid &&
            !await db.TrackComments.AsNoTracking().AnyAsync(x => x.Id == pid && x.TargetVersionId == versionId, ct))
            return Results.BadRequest(new { error = "Unknown parent comment." });

        var row = new TrackComment
        {
            Id = Guid.NewGuid(),
            TargetVersionId = versionId,
            ParentId = body.ParentId,
            TimestampSeconds = body.T,
            Body = text,
            Status = "open",
            AuthorUserId = userId,
            AuthorAnonId = userId is null ? anonId : null,
            AuthorDisplayName = userId is null ? Trim(body.AuthorDisplayName) : null,
        };
        db.TrackComments.Add(row);
        await db.SaveChangesAsync(ct);

        var ownerId = await VersionOwner(db, versionId, ct);
        if (ownerId is Guid oid)
            await notif.NotifyAsync(ActorRef.User(oid), "comment_created",
                new Dictionary<string, object?> { ["commentId"] = row.Id, ["versionId"] = versionId }, ct);

        var author = userId is Guid au
            ? ActorOf(au, await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == au, ct), null, null)
            : ActorOf(null, null, row.AuthorDisplayName, anonId);
        return Results.Created($"/api/versions/{versionId}/comments/{row.Id}", new CommentDto(
            row.Id, versionId, row.ParentId, row.TimestampSeconds, author, row.Body, row.Status,
            row.SuggestionId, row.CreatedAt));
    }

    private static async Task<IResult> InsertSuggestion(
        AppDbContext db, INotificationSink notif, Guid versionId, AccessDto access,
        Guid? userId, string? anonId, CreateSuggestionRequest body, CancellationToken ct)
    {
        if (!access.Gates.CanSuggest)
            return ErrorEnvelope.Build(403, "suggest_forbidden", "Suggestions aren't allowed here.");
        if (body is null || body.Chain.ValueKind != JsonValueKind.Object)
            return Results.BadRequest(new { error = "Chain must be a JSON object." });

        var row = new ReviewerSuggestion
        {
            Id = Guid.NewGuid(),
            SongVersionId = versionId,
            ChainJson = body.Chain.GetRawText(),
            CommentId = body.CommentId,
            Status = "proposed",
            FromUserId = userId,
            FromAnonId = userId is null ? anonId : null,
            FromDisplayName = userId is null ? Trim(body.FromDisplayName) : null,
        };
        db.Suggestions.Add(row);
        // Bidirectional link in the SAME SaveChanges when attached to a comment.
        if (body.CommentId is Guid cid)
        {
            var cm = await db.TrackComments.FirstOrDefaultAsync(
                x => x.Id == cid && x.TargetVersionId == versionId, ct);
            if (cm is not null) cm.SuggestionId = row.Id;
        }
        await db.SaveChangesAsync(ct);

        var ownerId = await VersionOwner(db, versionId, ct);
        if (ownerId is Guid oid)
            await notif.NotifyAsync(ActorRef.User(oid), "suggestion_created",
                new Dictionary<string, object?> { ["suggestionId"] = row.Id, ["versionId"] = versionId }, ct);

        var from = userId is Guid au
            ? ActorOf(au, await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == au, ct), null, null)
            : ActorOf(null, null, row.FromDisplayName, anonId);
        return Results.Created($"/api/versions/{versionId}/suggestions/{row.Id}", new SuggestionDto(
            row.Id, versionId, from, Parse(row.ChainJson), row.CommentId, row.CreatedInSessionId,
            row.Status, row.CreatedAt));
    }

    // ── authed version-scoped ────────────────────────────────────────────────
    private static async Task<IResult> ListCommentsAuthed(
        Guid versionId, ClaimsPrincipal user, AppDbContext db, AccessService access, CancellationToken ct)
    {
        var acc = await access.ResolveAsync(versionId, user.UserId(), viaValidToken: false, ct);
        if (!acc.CanView) return Results.NotFound();
        return Results.Ok(await LoadComments(db, versionId, ct));
    }

    private static async Task<IResult> PostCommentAuthed(
        Guid versionId, PostCommentRequest body, ClaimsPrincipal user, AppDbContext db,
        AccessService access, INotificationSink notif, CancellationToken ct)
    {
        var userId = user.UserId();
        var acc = await access.ResolveAsync(versionId, userId, viaValidToken: false, ct);
        if (!acc.CanView) return Results.NotFound();
        return await InsertComment(db, notif, versionId, acc, userId, null, body, ct);
    }

    private static async Task<IResult> ListSuggestionsAuthed(
        Guid versionId, ClaimsPrincipal user, AppDbContext db, AccessService access, CancellationToken ct)
    {
        var userId = user.UserId();
        var acc = await access.ResolveAsync(versionId, userId, viaValidToken: false, ct);
        if (!acc.CanView) return Results.NotFound();
        return Results.Ok(await LoadSuggestions(db, versionId, acc.Role == "owner", userId, ct));
    }

    private static async Task<IResult> PostSuggestionAuthed(
        Guid versionId, CreateSuggestionRequest body, ClaimsPrincipal user, AppDbContext db,
        AccessService access, INotificationSink notif, CancellationToken ct)
    {
        var userId = user.UserId();
        var acc = await access.ResolveAsync(versionId, userId, viaValidToken: false, ct);
        if (!acc.CanView) return Results.NotFound();
        return await InsertSuggestion(db, notif, versionId, acc, userId, null, body, ct);
    }

    // ── comment moderation (owner) + delete (author|owner) ───────────────────
    private static async Task<IResult> PatchCommentStatus(
        Guid commentId, PatchCommentStatusRequest body, ClaimsPrincipal user, AppDbContext db, CancellationToken ct)
    {
        var userId = user.UserId();
        var c = await db.TrackComments.FirstOrDefaultAsync(x => x.Id == commentId, ct);
        if (c?.TargetVersionId is not Guid vid) return Results.NotFound();
        if (await VersionOwner(db, vid, ct) != userId)
            return ErrorEnvelope.Build(403, "not_owner", "Only the owner can moderate comments.");
        if (!CommentStatuses.Contains(body?.Status ?? ""))
            return Results.BadRequest(new { error = "Invalid status." });
        c.Status = body!.Status;
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    private static async Task<IResult> DeleteComment(
        Guid commentId, ClaimsPrincipal user, AppDbContext db, CancellationToken ct)
    {
        var userId = user.UserId();
        var c = await db.TrackComments.FirstOrDefaultAsync(x => x.Id == commentId, ct);
        if (c?.TargetVersionId is not Guid vid) return Results.NotFound();
        var isOwner = await VersionOwner(db, vid, ct) == userId;
        if (!isOwner && c.AuthorUserId != userId)
            return ErrorEnvelope.Build(403, "forbidden", "You can't delete this comment.");
        c.DeletedAt = DateTimeOffset.UtcNow;   // soft delete
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    // ── suggestion accept (fork-to-preset) / reject (owner) ──────────────────
    private static async Task<IResult> AcceptSuggestion(
        Guid suggestionId, ClaimsPrincipal user, AppDbContext db, INotificationSink notif,
        IGamePlanSink gamePlan, CancellationToken ct)
    {
        var userId = user.UserId();
        var s = await db.Suggestions.FirstOrDefaultAsync(x => x.Id == suggestionId, ct);
        if (s is null) return Results.NotFound();
        if (await VersionOwner(db, s.SongVersionId, ct) != userId)
            return ErrorEnvelope.Build(403, "not_owner", "Only the owner can accept a suggestion.");

        var fromHandle = s.FromUserId is Guid fu
            ? await db.Users.AsNoTracking().Where(u => u.Id == fu).Select(u => u.Handle).FirstOrDefaultAsync(ct)
            : null;
        var name = $"From {s.FromDisplayName ?? fromHandle ?? "reviewer"}";
        var preset = new RackPreset
        {
            Id = Guid.NewGuid(),
            SongVersionId = s.SongVersionId,
            Name = name.Length > 120 ? name[..120] : name,
            Source = "user",                 // forked into the owner's library (PRP-1: no user_id)
            ChainJson = s.ChainJson,
            FromSuggestionId = s.Id,         // credit chain (D4.5)
            ViaGrantId = s.ViaGrantId,
            CreatedInSessionId = s.CreatedInSessionId,
        };
        db.RackPresets.Add(preset);
        s.Status = "accepted";
        s.ResolvedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);

        // Cross-slice seams (no-op until PRP-5/PRP-7) — drain to game plan + notify proposer.
        await gamePlan.InsertDrainItemAsync(s.SongVersionId, "suggestion", "preset", preset.Id.ToString(), ct);
        if (s.FromUserId is Guid pu)
            await notif.NotifyAsync(ActorRef.User(pu), "suggestion_accepted",
                new Dictionary<string, object?> { ["presetId"] = preset.Id }, ct);

        return Results.Ok(new RackPresetDto(
            preset.Id, preset.SongVersionId, preset.Name, preset.Source, Parse(preset.ChainJson),
            preset.CreatedInSessionId, preset.ViaGrantId, preset.CreatedAt, preset.UpdatedAt));
    }

    private static async Task<IResult> RejectSuggestion(
        Guid suggestionId, ClaimsPrincipal user, AppDbContext db, CancellationToken ct)
    {
        var userId = user.UserId();
        var s = await db.Suggestions.FirstOrDefaultAsync(x => x.Id == suggestionId, ct);
        if (s is null) return Results.NotFound();
        if (await VersionOwner(db, s.SongVersionId, ct) != userId)
            return ErrorEnvelope.Build(403, "not_owner", "Only the owner can reject a suggestion.");
        s.Status = "rejected";
        s.ResolvedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    // ── anonymous (opaque share token) ───────────────────────────────────────
    // Resolve token → (versionId, actor, access). Anon participation per gates (D4.4).
    private static async Task<(Guid VersionId, Guid? UserId, string? AnonId, AccessDto Access)?> ResolveAnonAsync(
        string token, ClaimsPrincipal user, ResourceTokenAuth tokenAuth, AccessService access, CancellationToken ct)
    {
        var resolved = await tokenAuth.ResolveAsync("share", token, user, ct);
        if (resolved is null) return null;
        var versionId = resolved.Resource.ResourceId;
        var userId = resolved.Actor.Type == ActorType.User ? resolved.Actor.UserId : null;
        var anonId = resolved.Actor.Type == ActorType.Anon ? resolved.Actor.AnonId : null;
        var acc = await access.ResolveAsync(versionId, userId, viaValidToken: true, ct);
        if (!acc.CanView) return null;
        return (versionId, userId, anonId, acc);
    }

    private static async Task<IResult> ListCommentsAnon(
        string token, ClaimsPrincipal user, ResourceTokenAuth tokenAuth, AccessService access,
        AppDbContext db, CancellationToken ct)
    {
        var hit = await ResolveAnonAsync(token, user, tokenAuth, access, ct);
        if (hit is null) return Results.NotFound();
        return Results.Ok(await LoadComments(db, hit.Value.VersionId, ct));
    }

    private static async Task<IResult> PostCommentAnon(
        string token, PostCommentRequest body, ClaimsPrincipal user, ResourceTokenAuth tokenAuth,
        AccessService access, AppDbContext db, INotificationSink notif, CancellationToken ct)
    {
        var hit = await ResolveAnonAsync(token, user, tokenAuth, access, ct);
        if (hit is null) return Results.NotFound();
        var (versionId, userId, anonId, acc) = hit.Value;
        return await InsertComment(db, notif, versionId, acc, userId, anonId, body, ct);
    }

    private static async Task<IResult> PostSuggestionAnon(
        string token, CreateSuggestionRequest body, ClaimsPrincipal user, ResourceTokenAuth tokenAuth,
        AccessService access, AppDbContext db, INotificationSink notif, CancellationToken ct)
    {
        var hit = await ResolveAnonAsync(token, user, tokenAuth, access, ct);
        if (hit is null) return Results.NotFound();
        var (versionId, userId, anonId, acc) = hit.Value;
        return await InsertSuggestion(db, notif, versionId, acc, userId, anonId, body, ct);
    }
}
