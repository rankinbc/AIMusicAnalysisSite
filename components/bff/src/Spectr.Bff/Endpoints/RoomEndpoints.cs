using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using StackExchange.Redis;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Channels;

namespace Spectr.Bff.Endpoints;

// Listen V3 (PRP-4) — Room sessions. GENERALIZES the coach SSE-over-Redis-pubsub
// relay (CoachConversationEndpoints) with a per-session fan-out channel + a
// durable WAL (RoomBus). Authority is per-event: transport/grant/revoke/end =
// host; rack/visuals = current scope holder; react/chat/status = any permitted
// (incl. anon, D4.4). Anon joins resolve the opaque session/share token via
// ResourceTokenAuth (?token=) — NEVER the JWT ?t= hook (PRP-0 hard rule).
public static class RoomEndpoints
{
    private const int MaxChatLength = 2000;
    private static readonly TimeSpan FinalizeDelay = TimeSpan.FromMinutes(3);
    private static readonly TimeSpan HeartbeatInterval = TimeSpan.FromSeconds(15);

    // Fixed reaction vocabulary — mirrors data.ts REACTION_EMOJI (seams §1).
    private static readonly HashSet<string> ReactionEmoji = new()
    {
        "👍", "🔥", "🤯", "😲", "🙌", "💜", "👀", "🤔", "😐", "👎", "😴", "🥱", "😬",
    };

    private static readonly JsonSerializerOptions Json = RoomBus.Json;

    public static IEndpointRouteBuilder MapRoomEndpoints(this IEndpointRouteBuilder app)
    {
        var v = app.MapGroup("/versions/{versionId:guid}").WithTags("room").RequireAuthorization();
        v.MapPost("/sessions", StartSession);
        v.MapGet("/sessions", ListSessions);

        // Session routes are anon-capable (anon listeners join via ?token=); each
        // handler resolves + gates the actor explicitly.
        var s = app.MapGroup("/sessions/{id:guid}").WithTags("room").AllowAnonymous();
        s.MapGet("/stream", StreamSession);
        s.MapGet("", GetSession);
        s.MapPost("/react", React);
        s.MapPost("/chat", Chat);
        s.MapPost("/status", Status);
        s.MapPost("/transport", Transport);
        s.MapPost("/visuals", Visuals);
        s.MapPost("/rack", Rack);
        s.MapPost("/grant", Grant);
        s.MapPost("/revoke", Revoke);
        s.MapPost("/end", EndSession);
        s.MapPost("/recap/publish", PublishRecap);
        return app;
    }

    // ── context resolution ───────────────────────────────────────────────────
    private sealed record RoomContext(
        Guid SessionId, Guid VersionId, Guid HostId, string Status,
        Guid? UserId, string? AnonId, ActorRef Actor, AccessDto Access);

    // Resolve the actor (authed JWT principal OR durable anon) + the session
    // facts + the access DTO. An opaque ?token= (session invite OR version share)
    // raises viaValidToken when it resolves to THIS session's version.
    private static async Task<RoomContext?> ResolveContextAsync(
        Guid sessionId, ClaimsPrincipal user, string? token,
        AppDbContext db, ResourceTokenAuth tokenAuth, AnonIdentity anon,
        AccessService access, CancellationToken ct)
    {
        var s = await db.ListeningSessions.AsNoTracking()
            .Where(x => x.Id == sessionId)
            .Select(x => new { x.SongVersionId, x.HostId, x.Status })
            .FirstOrDefaultAsync(ct);
        if (s is null) return null;

        var authed = user.Identity?.IsAuthenticated ?? false;
        Guid? userId = authed ? user.UserId() : null;

        var tokenValid = false;
        if (!string.IsNullOrWhiteSpace(token))
        {
            var r = await tokenAuth.ResolveAsync("session", token, user, ct)
                    ?? await tokenAuth.ResolveAsync("share", token, user, ct);
            if (r is not null && r.Resource.ResourceId == s.SongVersionId) tokenValid = true;
        }

        var actor = authed ? ActorRef.User(userId!.Value) : anon.Capture();
        var anonId = authed ? null : actor.AnonId;
        var acc = await access.ResolveAsync(s.SongVersionId, userId, tokenValid, ct);
        return new RoomContext(sessionId, s.SongVersionId, s.HostId, s.Status, userId, anonId, actor, acc);
    }

    // ── start / history ──────────────────────────────────────────────────────
    private static async Task<IResult> StartSession(
        Guid versionId, ClaimsPrincipal user, AppDbContext db, AccessService access,
        RoomBus bus, CancellationToken ct)
    {
        var userId = user.UserId();
        var acc = await access.ResolveAsync(versionId, userId, viaValidToken: false, ct);
        if (!acc.RoomHostable)
            return ErrorEnvelope.Build(403, "room_not_hostable", "You can't host a room here.");

        var session = new ListeningSession
        {
            Id = Guid.NewGuid(),
            SongVersionId = versionId,
            HostId = userId,
            Status = "live",
        };
        db.ListeningSessions.Add(session);
        await db.SaveChangesAsync(ct);

        // Seed the seq=1 base from the host's working chain (RackDraft) so chain
        // reconstruction always has a base, even if the host never touches the rack.
        var draftChain = await db.RackDrafts.AsNoTracking()
            .Where(d => d.SongVersionId == versionId)
            .Select(d => d.ChainJson)
            .FirstOrDefaultAsync(ct);
        var hostDto = await ActorProjection.ToDtoAsync(ActorRef.User(userId), db, ct);
        await bus.SeedBaseAsync(session.Id, ParseChainOrNeutral(draftChain), hostDto);

        return Results.Created($"/api/sessions/{session.Id}",
            new SessionDto(session.Id, versionId, userId, "live", session.StartedAt, null, null));
    }

    private static async Task<IResult> ListSessions(
        Guid versionId, ClaimsPrincipal user, AppDbContext db, AccessService access, CancellationToken ct)
    {
        var acc = await access.ResolveAsync(versionId, user.UserId(), viaValidToken: false, ct);
        if (!acc.CanView) return Results.NotFound();
        var rows = await db.ListeningSessions.AsNoTracking()
            .Where(s => s.SongVersionId == versionId)
            .OrderByDescending(s => s.StartedAt)
            .ToListAsync(ct);
        return Results.Ok(rows.Select(s => new SessionDto(
            s.Id, s.SongVersionId, s.HostId, s.Status, s.StartedAt, s.EndedAt, null)).ToList());
    }

    private static async Task<IResult> GetSession(
        Guid id, ClaimsPrincipal user, string? token, AppDbContext db, ResourceTokenAuth tokenAuth,
        AnonIdentity anon, AccessService access, RoomBus bus, IJobQueue queue, CancellationToken ct)
    {
        var ctx = await ResolveContextAsync(id, user, token, db, tokenAuth, anon, access, ct);
        if (ctx is null || !ctx.Access.CanView) return Results.NotFound();

        var s = await db.ListeningSessions.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s is null) return Results.NotFound();

        // Lazy-on-read finalize BACKSTOP (G1): a presence-empty live session (a
        // lost delayed finalize) gets an immediate finalize enqueue here.
        if (s.Status == "live" && await bus.PresenceEmptyAsync(id))
            await EnqueueFinalizeAsync(queue, id, delayed: false);

        var recap = s.RecapJson is null ? null : TryParseNode(s.RecapJson);
        return Results.Ok(new SessionDto(
            s.Id, s.SongVersionId, s.HostId, s.Status, s.StartedAt, s.EndedAt, recap));
    }

    // ── SSE relay (generalizes coach: subscribe → snapshot → flush → stream) ──
    private static async Task StreamSession(
        Guid id, ClaimsPrincipal user, string? token, AppDbContext db, ResourceTokenAuth tokenAuth,
        AnonIdentity anon, AccessService access, RoomBus bus, IConnectionMultiplexer redis,
        IJobQueue queue, HttpContext httpCtx, CancellationToken ct)
    {
        var ctx = await ResolveContextAsync(id, user, token, db, tokenAuth, anon, access, ct);
        if (ctx is null) { httpCtx.Response.StatusCode = 404; return; }
        if (!ctx.Access.RoomJoinable) { httpCtx.Response.StatusCode = 403; return; }

        SetSseHeaders(httpCtx);
        var actorDto = await ActorProjection.ToDtoAsync(ctx.Actor, db, ct);
        var actorKey = ctx.Actor.ActorKey;

        // ORDER MATTERS (G3 race): subscribe FIRST, buffer inbound, THEN snapshot,
        // THEN stream live (skipping deltas already folded into the snapshot).
        var channel = RoomBus.ChannelFor(id);
        var sub = redis.GetSubscriber();
        var frames = Channel.CreateBounded<string>(new BoundedChannelOptions(2048)
        {
            SingleReader = true,
            SingleWriter = false,
            FullMode = BoundedChannelFullMode.DropOldest,
        });
        void Handler(ChannelMessage msg)
        {
            var p = msg.Message.ToString();
            if (!string.IsNullOrEmpty(p)) frames.Writer.TryWrite(p);
        }
        // Ordered form — see CoachConversationEndpoints.cs::StreamMessage for the
        // identical fix + PRPs/coach-stream-ordering-fix.md for the confirmed bug.
        var messageQueue = await sub.SubscribeAsync(channel);
        messageQueue.OnMessage(Handler);

        try
        {
            var snap = await bus.SnapshotAsync(id);
            await WriteSseFrame(httpCtx, "sync", JsonSerializer.Serialize(new
            {
                type = "sync",
                chain = snap.Chain,
                transport = snap.Transport,
                visuals = snap.Visuals,
                roster = snap.Roster,
                feed = snap.Feed,
                snapshotSeq = snap.SnapshotSeq,
            }, Json), null, ct);

            // Presence join AFTER the snapshot (so the new joiner is broadcast).
            await bus.PresenceAddAsync(id, actorKey, actorDto);
            await bus.AppendAndPublishAsync(id, new
            {
                type = "presence",
                at = RoomBus.NowMs(),
                actor = actorDto,
                state = "join",
            });

            await RelayLoop(httpCtx, frames.Reader, snap.SnapshotSeq, ct);
        }
        finally
        {
            try { await messageQueue.UnsubscribeAsync(); } catch { /* best-effort */ }
            frames.Writer.TryComplete();
            // Leave is best-effort (ct is cancelled) — RoomBus uses no ct.
            try
            {
                await bus.PresenceRemoveAsync(id, actorKey);
                await bus.AppendAndPublishAsync(id, new
                {
                    type = "presence",
                    at = RoomBus.NowMs(),
                    actor = actorDto,
                    state = "leave",
                });
                // Last-leaver delayed finalize (G1) — re-checked by the actor.
                if (await bus.PresenceEmptyAsync(id))
                    await EnqueueFinalizeAsync(queue, id, delayed: true);
            }
            catch { /* best-effort */ }
        }
    }

    private static async Task RelayLoop(
        HttpContext httpCtx, ChannelReader<string> reader, long snapshotSeq, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            using var waitCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            var nextFrame = reader.ReadAsync(waitCts.Token).AsTask();
            var heartbeat = Task.Delay(HeartbeatInterval, waitCts.Token);
            var winner = await Task.WhenAny(nextFrame, heartbeat);
            if (ct.IsCancellationRequested) break;

            if (winner == nextFrame)
            {
                string payload;
                try { payload = await nextFrame; }
                catch (ChannelClosedException) { break; }
                catch (OperationCanceledException) { break; }
                waitCts.Cancel();
                try { await heartbeat; } catch (OperationCanceledException) { }

                // Drop deltas already folded into the snapshot (seq <= snapshotSeq);
                // state events are idempotent, feed events dedup by seq.
                var seq = SeqOf(payload);
                if (seq > snapshotSeq)
                    await WriteSseFrame(httpCtx, "event", payload, seq, ct);
                continue;
            }

            waitCts.Cancel();
            try { await nextFrame; } catch (OperationCanceledException) { } catch (ChannelClosedException) { }
            await WriteSseComment(httpCtx, "heartbeat", ct);
        }
    }

    // ── participant actions (react / chat / status) ──────────────────────────
    private static async Task<IResult> React(
        Guid id, ReactRequest body, ClaimsPrincipal user, string? token, AppDbContext db,
        ResourceTokenAuth tokenAuth, AnonIdentity anon, AccessService access, RoomBus bus, CancellationToken ct)
    {
        var ctx = await ResolveContextAsync(id, user, token, db, tokenAuth, anon, access, ct);
        if (ctx is null) return Results.NotFound();
        if (!ctx.Access.RoomJoinable) return ErrorEnvelope.Build(403, "not_joinable", "You haven't joined this room.");
        if (ctx.Status != "live") return ErrorEnvelope.Build(409, "session_ended", "This session has ended.");
        if (body is null || !ReactionEmoji.Contains(body.Emoji))
            return Results.BadRequest(new { error = "Unknown reaction emoji." });

        var actorDto = await ActorProjection.ToDtoAsync(ctx.Actor, db, ct);
        await bus.AppendAndPublishAsync(id, new
        {
            type = "reaction",
            at = RoomBus.NowMs(),
            id = Guid.NewGuid(),
            actor = actorDto,
            emoji = body.Emoji,
            t = body.T ?? 0,
            text = body.Text,
        });
        return Results.Accepted();
    }

    private static async Task<IResult> Chat(
        Guid id, ChatRequest body, ClaimsPrincipal user, string? token, AppDbContext db,
        ResourceTokenAuth tokenAuth, AnonIdentity anon, AccessService access, RoomBus bus, CancellationToken ct)
    {
        var ctx = await ResolveContextAsync(id, user, token, db, tokenAuth, anon, access, ct);
        if (ctx is null) return Results.NotFound();
        if (!ctx.Access.RoomJoinable) return ErrorEnvelope.Build(403, "not_joinable", "You haven't joined this room.");
        if (ctx.Status != "live") return ErrorEnvelope.Build(409, "session_ended", "This session has ended.");
        // Chat respects the same gate as comments (named-policy blocks anon).
        if (!ctx.Access.Gates.CanComment)
            return ErrorEnvelope.Build(403, "chat_forbidden", "Chat isn't allowed here.");
        var text = (body?.Body ?? "").Trim();
        if (string.IsNullOrEmpty(text)) return Results.BadRequest(new { error = "Message is required." });
        if (text.Length > MaxChatLength) return Results.BadRequest(new { error = "Message too long." });

        var actorDto = await ActorProjection.ToDtoAsync(ctx.Actor, db, ct);
        await bus.AppendAndPublishAsync(id, new
        {
            type = "chat",
            at = RoomBus.NowMs(),
            id = Guid.NewGuid(),
            actor = actorDto,
            body = text,
            t = body!.T ?? 0,
        });
        return Results.Accepted();
    }

    private static async Task<IResult> Status(
        Guid id, StatusRequest body, ClaimsPrincipal user, string? token, AppDbContext db,
        ResourceTokenAuth tokenAuth, AnonIdentity anon, AccessService access, RoomBus bus, CancellationToken ct)
    {
        var ctx = await ResolveContextAsync(id, user, token, db, tokenAuth, anon, access, ct);
        if (ctx is null) return Results.NotFound();
        if (!ctx.Access.RoomJoinable) return ErrorEnvelope.Build(403, "not_joinable", "You haven't joined this room.");
        if (ctx.Status != "live") return ErrorEnvelope.Build(409, "session_ended", "This session has ended.");
        if (body is null || !ReactionEmoji.Contains(body.Emoji))
            return Results.BadRequest(new { error = "Unknown status emoji." });

        var actorDto = await ActorProjection.ToDtoAsync(ctx.Actor, db, ct);
        await bus.AppendAndPublishAsync(id, new
        {
            type = "status",
            at = RoomBus.NowMs(),
            actor = actorDto,
            status = body.Emoji,
        });
        return Results.Accepted();
    }

    // ── host / controller actions (transport / visuals / rack) ───────────────
    private static async Task<IResult> Transport(
        Guid id, TransportRequest body, ClaimsPrincipal user, string? token, AppDbContext db,
        ResourceTokenAuth tokenAuth, AnonIdentity anon, AccessService access, RoomBus bus, CancellationToken ct)
    {
        var (ctx, err) = await RequireLiveAsync(id, user, token, db, tokenAuth, anon, access, ct);
        if (err is not null) return err;
        var role = await access.ResolveSessionRoleAsync(id, ctx!.UserId, ctx.AnonId, ct);
        if (!role.IsHost) return ErrorEnvelope.Build(403, "not_host", "Only the host drives transport.");

        var actorDto = await ActorProjection.ToDtoAsync(ctx.Actor, db, ct);
        await bus.AppendAndPublishAsync(id, new
        {
            type = "transport",
            at = RoomBus.NowMs(),
            actor = actorDto,
            playing = body!.Playing,
            position = body.Position,
        });
        await bus.SetTransportAsync(id, new JsonObject { ["playing"] = body.Playing, ["position"] = body.Position });
        return Results.Accepted();
    }

    private static async Task<IResult> Visuals(
        Guid id, VisualsRequest body, ClaimsPrincipal user, string? token, AppDbContext db,
        ResourceTokenAuth tokenAuth, AnonIdentity anon, AccessService access, RoomBus bus, CancellationToken ct)
    {
        var (ctx, err) = await RequireLiveAsync(id, user, token, db, tokenAuth, anon, access, ct);
        if (err is not null) return err;
        var role = await access.ResolveSessionRoleAsync(id, ctx!.UserId, ctx.AnonId, ct);
        if (!role.HoldsVisuals) return ErrorEnvelope.Build(403, "not_visuals_controller", "You don't control the visuals.");

        var actorDto = await ActorProjection.ToDtoAsync(ctx.Actor, db, ct);
        var stages = body!.Stages is null ? null : new JsonArray(body.Stages.Select(x => (JsonNode?)x).ToArray());
        var state = new JsonObject
        {
            ["patch"] = body.Patch?.DeepClone(),
            ["stages"] = stages?.DeepClone(),
            ["director"] = body.Director,
        };
        await bus.AppendAndPublishAsync(id, new
        {
            type = "visuals",
            at = RoomBus.NowMs(),
            actor = actorDto,
            patch = body.Patch,
            stages = body.Stages,
            director = body.Director,
        });
        await bus.SetVisualsAsync(id, state);
        return Results.Accepted();
    }

    private static async Task<IResult> Rack(
        Guid id, RackRequest body, ClaimsPrincipal user, string? token, AppDbContext db,
        ResourceTokenAuth tokenAuth, AnonIdentity anon, AccessService access, RoomBus bus, CancellationToken ct)
    {
        var (ctx, err) = await RequireLiveAsync(id, user, token, db, tokenAuth, anon, access, ct);
        if (err is not null) return err;
        var role = await access.ResolveSessionRoleAsync(id, ctx!.UserId, ctx.AnonId, ct);
        if (!role.HoldsRack) return ErrorEnvelope.Build(403, "not_rack_controller", "You don't control the rack.");
        if (body is null || string.IsNullOrWhiteSpace(body.EffectId) || body.Params is null)
            return Results.BadRequest(new { error = "effectId and params are required." });

        var actorDto = await ActorProjection.ToDtoAsync(ctx.Actor, db, ct);
        // Durable record FIRST (the delta clients apply), then update the chain cache.
        await bus.AppendAndPublishAsync(id, new
        {
            type = "rack",
            at = RoomBus.NowMs(),
            actor = actorDto,
            effectId = body.EffectId,
            @params = body.Params,
        });
        await bus.ApplyRackDeltaAsync(id, body.EffectId, body.Params);
        return Results.Accepted();
    }

    // ── control handoff (grant / revoke) ─────────────────────────────────────
    private static async Task<IResult> Grant(
        Guid id, GrantRequest body, ClaimsPrincipal user, string? token, AppDbContext db,
        ResourceTokenAuth tokenAuth, AnonIdentity anon, AccessService access, RoomBus bus, CancellationToken ct)
    {
        var (ctx, err) = await RequireLiveAsync(id, user, token, db, tokenAuth, anon, access, ct);
        if (err is not null) return err;
        var role = await access.ResolveSessionRoleAsync(id, ctx!.UserId, ctx.AnonId, ct);
        if (!role.IsHost) return ErrorEnvelope.Build(403, "not_host", "Only the host can grant control.");
        if (body is null || (body.Scope != "rack" && body.Scope != "visuals"))
            return Results.BadRequest(new { error = "scope must be 'rack' or 'visuals'." });
        if (body.Grantee is null || (body.Grantee.UserId is null && string.IsNullOrEmpty(body.Grantee.AnonId)))
            return Results.BadRequest(new { error = "A grantee (userId or anonId) is required." });

        // Auto-revoke the prior active holder, THEN insert — two SaveChanges so
        // the partial-unique (session, scope) index never transiently conflicts.
        var prior = await db.ControlGrants
            .Where(g => g.SessionId == id && g.Scope == body.Scope && g.RevokedAt == null)
            .ToListAsync(ct);
        var now = DateTimeOffset.UtcNow;
        foreach (var p in prior) p.RevokedAt = now;
        if (prior.Count > 0) await db.SaveChangesAsync(ct);

        var grant = new ControlGrant
        {
            Id = Guid.NewGuid(),
            SessionId = id,
            Scope = body.Scope,
            GranteeUserId = body.Grantee.UserId,
            GranteeAnonId = body.Grantee.UserId is null ? body.Grantee.AnonId : null,
            GranteeDisplayName = body.Grantee.UserId is null ? body.Grantee.DisplayName : null,
            GrantedBy = ctx.UserId!.Value,
            GrantedAt = now,
        };
        db.ControlGrants.Add(grant);
        await db.SaveChangesAsync(ct);

        var dto = await GrantDtoAsync(grant, ctx.Actor, db, ct);
        await bus.AppendAndPublishAsync(id, new { type = "grant", at = RoomBus.NowMs(), grant = dto });
        return Results.Ok(dto);
    }

    private static async Task<IResult> Revoke(
        Guid id, RevokeRequest body, ClaimsPrincipal user, string? token, AppDbContext db,
        ResourceTokenAuth tokenAuth, AnonIdentity anon, AccessService access, RoomBus bus, CancellationToken ct)
    {
        var (ctx, err) = await RequireLiveAsync(id, user, token, db, tokenAuth, anon, access, ct);
        if (err is not null) return err;
        var role = await access.ResolveSessionRoleAsync(id, ctx!.UserId, ctx.AnonId, ct);
        if (!role.IsHost) return ErrorEnvelope.Build(403, "not_host", "Only the host can revoke control.");
        if (body is null || (body.Scope != "rack" && body.Scope != "visuals"))
            return Results.BadRequest(new { error = "scope must be 'rack' or 'visuals'." });

        var active = await db.ControlGrants
            .Where(g => g.SessionId == id && g.Scope == body.Scope && g.RevokedAt == null)
            .ToListAsync(ct);
        if (active.Count == 0) return Results.NoContent();
        var now = DateTimeOffset.UtcNow;
        foreach (var g in active) g.RevokedAt = now;
        await db.SaveChangesAsync(ct);

        // Echo the revoked grant so holder chips clear.
        var dto = await GrantDtoAsync(active[0], ctx.Actor, db, ct);
        await bus.AppendAndPublishAsync(id, new { type = "grant", at = RoomBus.NowMs(), grant = dto });
        return Results.NoContent();
    }

    // ── finalize (end) + recap publish ───────────────────────────────────────
    private static async Task<IResult> EndSession(
        Guid id, ClaimsPrincipal user, AppDbContext db, IJobQueue queue, RoomBus bus, CancellationToken ct)
    {
        var userId = user.UserId();
        var hostId = await db.ListeningSessions.AsNoTracking()
            .Where(s => s.Id == id).Select(s => (Guid?)s.HostId).FirstOrDefaultAsync(ct);
        if (hostId is null) return Results.NotFound();
        if (hostId != userId) return ErrorEnvelope.Build(403, "not_host", "Only the host can end the session.");

        // The synthesize_recap actor is the SOLE flusher (CAS log → events_json +
        // recap). The BFF never flushes inline (no DEL-before-actor-reads race).
        await EnqueueFinalizeAsync(queue, id, delayed: false);

        // Transient `ended` signal — publish-only (NO WAL append, NO seq).
        // Clients fold it, show the ended state, and close their streams —
        // which empties presence and lets the finalize actor proceed promptly.
        await bus.PublishTransientAsync(id, "ended");
        return Results.Accepted();
    }

    private static async Task<IResult> PublishRecap(
        Guid id, RecapPublishRequest body, ClaimsPrincipal user, AppDbContext db,
        IGamePlanSink gamePlan, CancellationToken ct)
    {
        var userId = user.UserId();
        var s = await db.ListeningSessions.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s is null) return Results.NotFound();
        if (s.HostId != userId) return ErrorEnvelope.Build(403, "not_host", "Only the host can publish the recap.");
        if (string.IsNullOrEmpty(s.RecapJson)) return ErrorEnvelope.Build(409, "recap_not_ready", "The recap isn't ready yet.");

        var moments = TryParseNode(s.RecapJson)?["hottestMoments"] as JsonArray;
        if (moments is null) return ErrorEnvelope.Build(409, "recap_not_ready", "The recap has no moments.");

        var created = new List<CommentDto>();
        foreach (var mid in (body?.MomentIds ?? Array.Empty<int>()).Distinct())
        {
            if (mid < 0 || mid >= moments.Count) continue;
            var m = moments[mid];
            var t = m?["t"]?.GetValue<double>();
            var count = m?["reactionCount"]?.GetValue<int>() ?? 0;
            var emoji = m?["topEmoji"]?.GetValue<string>() ?? "🔥";
            var row = new TrackComment
            {
                Id = Guid.NewGuid(),
                TargetVersionId = s.SongVersionId,
                TimestampSeconds = t,
                Body = $"{emoji} {count} reactions here",
                Status = "open",
                AuthorUserId = userId,
            };
            db.TrackComments.Add(row);
            created.Add(new CommentDto(row.Id, s.SongVersionId, null, t,
                new ActorRefDto("user", userId, null, null, ActorProjection.HueFrom(userId.ToString())),
                row.Body, row.Status, null, row.CreatedAt));
        }
        if (created.Count == 0) return Results.BadRequest(new { error = "No valid moments selected." });

        // One transaction: recap comments + the 11.10 publish stamp commit or
        // roll back together (a stamp without comments would announce a recap
        // to feeds that publish actually failed to produce, and vice versa).
        // Only the first publish stamps, so re-publishing never reorders feeds.
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            await db.SaveChangesAsync(ct);
            await db.ListeningSessions
                .Where(x => x.Id == id && x.RecapPublishedAt == null)
                .ExecuteUpdateAsync(u => u.SetProperty(x => x.RecapPublishedAt, DateTimeOffset.UtcNow), ct);
            await tx.CommitAsync(ct);
        }

        foreach (var c in created)
            await gamePlan.InsertDrainItemAsync(s.SongVersionId, "recap", "comment", c.Id.ToString(), ct);
        return Results.Ok(created);
    }

    // ── helpers ──────────────────────────────────────────────────────────────
    private static async Task<(RoomContext? Ctx, IResult? Err)> RequireLiveAsync(
        Guid id, ClaimsPrincipal user, string? token, AppDbContext db, ResourceTokenAuth tokenAuth,
        AnonIdentity anon, AccessService access, CancellationToken ct)
    {
        var ctx = await ResolveContextAsync(id, user, token, db, tokenAuth, anon, access, ct);
        if (ctx is null) return (null, Results.NotFound());
        if (!ctx.Access.RoomJoinable) return (null, ErrorEnvelope.Build(403, "not_joinable", "You haven't joined this room."));
        if (ctx.Status != "live") return (null, ErrorEnvelope.Build(409, "session_ended", "This session has ended."));
        return (ctx, null);
    }

    private static async Task<ControlGrantDto> GrantDtoAsync(
        ControlGrant g, ActorRef host, AppDbContext db, CancellationToken ct)
    {
        ActorRefDto grantee = g.GranteeUserId is Guid gu
            ? await ActorProjection.ToDtoAsync(ActorRef.User(gu), db, ct)
            : new ActorRefDto("anon", null, null, g.GranteeDisplayName,
                ActorProjection.HueFrom(g.GranteeAnonId ?? g.GranteeDisplayName));
        var grantedBy = await ActorProjection.ToDtoAsync(host, db, ct);
        return new ControlGrantDto(g.Id, g.SessionId, g.Scope, grantee, grantedBy, g.RevokedAt);
    }

    private static Task EnqueueFinalizeAsync(IJobQueue queue, Guid sessionId, bool delayed)
    {
        var args = new object[] { sessionId.ToString() };
        return delayed
            ? queue.EnqueueDelayedAsync(DramatiqTasks.SynthesizeRecap, args, DramatiqQueues.AnalysisPaid, FinalizeDelay)
            : queue.EnqueueAsync(DramatiqTasks.SynthesizeRecap, args, DramatiqQueues.AnalysisPaid);
    }

    private static JsonNode ParseChainOrNeutral(string? chainJson)
    {
        if (!string.IsNullOrWhiteSpace(chainJson))
        {
            try
            {
                if (JsonNode.Parse(chainJson) is JsonObject obj) return obj;
            }
            catch (JsonException) { /* fall through to neutral */ }
        }
        return new JsonObject
        {
            ["order"] = new JsonArray(),
            ["modules"] = new JsonObject(),
            ["masterBypass"] = false,
        };
    }

    private static long SeqOf(string payload)
    {
        try
        {
            using var doc = JsonDocument.Parse(payload);
            return doc.RootElement.TryGetProperty("seq", out var s)
                && s.TryGetInt64(out var v) ? v : long.MaxValue;
        }
        catch (JsonException) { return long.MaxValue; }
    }

    private static JsonNode? TryParseNode(string raw)
    {
        try { return JsonNode.Parse(raw); } catch (JsonException) { return null; }
    }

    // ── SSE plumbing (mirrors CoachConversationEndpoints) ────────────────────
    private static void SetSseHeaders(HttpContext httpCtx)
    {
        httpCtx.Response.Headers["Content-Type"] = "text/event-stream";
        httpCtx.Response.Headers["Cache-Control"] = "no-cache";
        httpCtx.Response.Headers["X-Accel-Buffering"] = "no";
    }

    private static async Task WriteSseFrame(
        HttpContext httpCtx, string eventName, string dataPayload, long? id, CancellationToken ct)
    {
        var encoded = dataPayload.Replace("\r\n", "\n").Replace("\n", "\\n");
        var sb = new StringBuilder();
        if (id is long i) sb.Append("id: ").Append(i).Append('\n');
        sb.Append("event: ").Append(eventName).Append('\n')
          .Append("data: ").Append(encoded).Append("\n\n");
        try
        {
            await httpCtx.Response.Body.WriteAsync(Encoding.UTF8.GetBytes(sb.ToString()), ct);
            await httpCtx.Response.Body.FlushAsync(ct);
        }
        catch (OperationCanceledException) { /* client gone */ }
    }

    private static async Task WriteSseComment(HttpContext httpCtx, string comment, CancellationToken ct)
    {
        var frame = Encoding.UTF8.GetBytes($": {comment}\n\n");
        try
        {
            await httpCtx.Response.Body.WriteAsync(frame, ct);
            await httpCtx.Response.Body.FlushAsync(ct);
        }
        catch (OperationCanceledException) { /* client gone */ }
    }
}
