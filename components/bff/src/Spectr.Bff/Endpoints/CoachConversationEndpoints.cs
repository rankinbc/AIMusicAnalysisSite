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
using System.Threading.Channels;

namespace Spectr.Bff.Endpoints;

// Story 1.5 / AR9 / AR10: persisted coach conversations. The actual reply
// generation happens in the Python `coach_reply` actor (see
// components/worker/app/coach_actor.py). This endpoint group only:
//   - persists user/assistant rows on POST
//   - get-or-creates the Conversation row per (analysis, user)
//   - enqueues the actor on the `coach` queue
//   - returns the polling view on GET
//
// The legacy /api/coach/{jobId}/chat group (CoachEndpoints.cs) is unchanged
// — the existing v2 CoachChat.tsx still hits it. Story 1.8 swaps the
// frontend over to these new endpoints and deletes the legacy.

public static class CoachConversationEndpoints
{
    // Coach offline body — kept verbatim in lockstep with UX-DR17 + the
    // worker's COACH_OFFLINE_BODY in coach_actor.py.
    private const string CoachOfflineBody =
        "Coach is offline — your measured analysis and rule-based findings are unaffected.";

    private const int MaxMessageLength = 4000;

    // Snake-case-aware options for parsing the assistant row's evidence
    // JSONB (the worker writes `{"label": "...", "path": "..."}` keys).
    private static readonly JsonSerializerOptions EvidenceJsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
    };

    public static IEndpointRouteBuilder MapCoachConversationEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/coach/{analysisId:guid}")
            .WithTags("coach-conversation")
            .RequireAuthorization();

        g.MapPost("/messages", PostMessage);
        g.MapGet("/conversation", GetConversation);
        // Story 1.6 / AR9 / AR44: SSE relay for the worker's per-token
        // pub/sub stream on ``coach:{conversationId}:{messageId}``. Event
        // types are {token|done|error|refusal}; a `: heartbeat` comment
        // fires every 15 s. If pub/sub goes idle for >30 s mid-stream,
        // the handler re-reads the persisted row and emits a synthesized
        // ``error`` frame (`coach_stream_idle`). On client disconnect we
        // SET `coach:cancel:{messageId}` so the worker can break its
        // generation loop between deltas.
        g.MapGet("/messages/{messageId:guid}/stream", StreamMessage);

        return app;
    }

    // POST /api/coach/{analysisId}/messages
    private static async Task<IResult> PostMessage(
        Guid analysisId,
        CreateCoachMessageRequest body,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IJobQueue queue,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();

        if (body is null || string.IsNullOrWhiteSpace(body.Content))
        {
            return ErrorEnvelope(
                StatusCodes.Status400BadRequest,
                "coach_message_invalid",
                "Message content is required.");
        }
        if (body.Content.Length > MaxMessageLength)
        {
            return ErrorEnvelope(
                StatusCodes.Status400BadRequest,
                "coach_message_invalid",
                $"Message exceeds {MaxMessageLength} characters.");
        }

        var analysis = await db.Analyses.AsNoTracking()
            .Where(a => a.Id == analysisId && a.UserId == userId)
            .Select(a => new { a.Id, a.DegradationNotice })
            .FirstOrDefaultAsync(ct);
        if (analysis is null) return Results.NotFound();

        // Degraded-analysis short-circuit (belt-and-braces with actor A.1):
        // skip the enqueue entirely so a blown-budget analysis doesn't
        // burn an extra queue dispatch only to refuse server-side.
        if (!string.IsNullOrEmpty(analysis.DegradationNotice))
        {
            return ErrorEnvelope(
                StatusCodes.Status503ServiceUnavailable,
                "coach_offline",
                CoachOfflineBody);
        }

        // Get-or-create the conversation row. The unique constraint on
        // (analysis_id, user_id) means concurrent POSTs race-then-converge
        // on the same row. Story 1.5 code review B-H1: the original code
        // didn't catch the unique-violation a second concurrent POST would
        // hit (returned 500 instead of converging). Retry once on the
        // UniqueViolationException-via-DbUpdateException and re-read.
        var conversation = await GetOrCreateConversationAsync(
            db, analysisId, userId, ct);

        var now = DateTimeOffset.UtcNow;
        var userRow = new CoachMessage
        {
            Id = Guid.NewGuid(),
            ConversationId = conversation.Id,
            Role = "user",
            Status = "complete",
            Content = body.Content,
            Evidence = null,
            RefusalReason = null,
            LlmCallId = null,
            CreatedAt = now,
            CompletedAt = now,
        };
        var assistantRow = new CoachMessage
        {
            Id = Guid.NewGuid(),
            ConversationId = conversation.Id,
            Role = "assistant",
            Status = "pending",
            Content = string.Empty,
            Evidence = null,
            RefusalReason = null,
            LlmCallId = null,
            // Created one tick later so the ASC ordering surfaces the user
            // row first when the client polls.
            CreatedAt = now.AddMilliseconds(1),
            CompletedAt = null,
        };
        db.CoachMessages.Add(userRow);
        db.CoachMessages.Add(assistantRow);

        await db.SaveChangesAsync(ct);

        // Enqueue the worker actor. Story 1.5 code review B-H2: the actor
        // signature is (conversation_id, user_message_id, assistant_message_id)
        // so the worker doesn't have to infer the user-question from the
        // tail (which picks the wrong row under concurrent POSTs). On
        // enqueue failure (Redis down) we mark the assistant row error
        // synchronously so the user sees a real message instead of a
        // stuck spinner.
        try
        {
            await queue.EnqueueAsync(
                DramatiqTasks.CoachReply,
                new object[]
                {
                    conversation.Id.ToString(),
                    userRow.Id.ToString(),
                    assistantRow.Id.ToString(),
                },
                DramatiqQueues.Coach,
                ct);
        }
        catch (Exception)
        {
            assistantRow.Status = "error";
            assistantRow.Content = "The coach hit a transient error. Please try again.";
            assistantRow.CompletedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);
            return ErrorEnvelope(
                StatusCodes.Status503ServiceUnavailable,
                "coach_queue_unavailable",
                "Coach queue is temporarily unavailable. Please try again.");
        }

        return Results.Ok(new CreateCoachMessageResponse(
            conversation.Id, userRow.Id, assistantRow.Id));
    }

    // GET /api/coach/{analysisId}/conversation
    private static async Task<IResult> GetConversation(
        Guid analysisId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();

        // Ownership gate — same projection pattern as VerdictEndpoints.
        var owns = await db.Analyses.AsNoTracking()
            .AnyAsync(a => a.Id == analysisId && a.UserId == userId, ct);
        if (!owns) return Results.NotFound();

        var conversation = await db.Conversations.AsNoTracking()
            .FirstOrDefaultAsync(c => c.AnalysisId == analysisId && c.UserId == userId, ct);
        if (conversation is null)
        {
            // Empty-state — the UI may poll before the user has sent anything.
            return Results.Ok(new CoachConversationDto(
                Guid.Empty, analysisId, Array.Empty<CoachMessageDto>()));
        }

        var rows = await db.CoachMessages.AsNoTracking()
            .Where(m => m.ConversationId == conversation.Id)
            .OrderBy(m => m.CreatedAt)
            .ToListAsync(ct);

        var messages = rows
            .Select(m => new CoachMessageDto(
                m.Id,
                m.Role,
                m.Status,
                m.Content,
                ParseEvidence(m.Evidence),
                m.RefusalReason,
                m.CreatedAt,
                m.CompletedAt))
            .ToList();

        return Results.Ok(new CoachConversationDto(conversation.Id, analysisId, messages));
    }

    // Story 1.5 code review B-H1: race-safe get-or-create on
    // (analysis_id, user_id). The unique constraint guarantees at-most-one
    // row per pair; on the rare race a second SaveChanges raises a
    // unique-violation, we detach the locally-tracked draft and re-read
    // the row the winning POST inserted.
    private static async Task<Conversation> GetOrCreateConversationAsync(
        AppDbContext db, Guid analysisId, Guid userId, CancellationToken ct)
    {
        var existing = await db.Conversations
            .FirstOrDefaultAsync(c => c.AnalysisId == analysisId && c.UserId == userId, ct);
        if (existing is not null) return existing;

        var draft = new Conversation
        {
            Id = Guid.NewGuid(),
            AnalysisId = analysisId,
            UserId = userId,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Conversations.Add(draft);
        try
        {
            await db.SaveChangesAsync(ct);
            return draft;
        }
        catch (DbUpdateException)
        {
            // A concurrent POST may have won the unique-index race. Detach
            // our in-memory draft so EF won't re-attempt to INSERT it on
            // the next SaveChanges (the assistant/user rows we're about to
            // add). Then look for the winner — if it exists, return it; if
            // not, the failure was something else, so re-raise.
            db.Entry(draft).State = EntityState.Detached;
            var winner = await db.Conversations
                .FirstOrDefaultAsync(
                    c => c.AnalysisId == analysisId && c.UserId == userId, ct);
            if (winner is null) throw;
            return winner;
        }
    }

    private static IReadOnlyList<CoachEvidenceDto>? ParseEvidence(string? raw)
    {
        if (string.IsNullOrEmpty(raw)) return null;
        try
        {
            return JsonSerializer.Deserialize<List<CoachEvidenceDto>>(raw, EvidenceJsonOpts);
        }
        catch (JsonException)
        {
            // Corrupt JSONB on one row shouldn't sink the whole poll.
            return null;
        }
    }

    private static IResult ErrorEnvelope(int status, string code, string message)
    {
        return Results.Json(
            new { error = new { code, message, details = (object?)null } },
            statusCode: status);
    }

    // ── Story 1.6: SSE relay for the worker's per-token pub/sub stream ────

    // Wire-format JSON used for SSE `data:` fields. Property names match the
    // worker's published frames (snake_case-on-the-wire would also work, but
    // the rest of the BFF emits camelCase via JsonSerializerDefaults.Web so
    // we stay consistent — frame fields are short, single-word camelCase).
    private static readonly JsonSerializerOptions StreamFrameJsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    // Idle-fallback window matches the architecture spec line 203:
    // "on Redis idle >30s, fall back to reading persisted partial message
    // → close with error event".
    private static readonly TimeSpan StreamIdleTimeout = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan StreamHeartbeatInterval = TimeSpan.FromSeconds(15);

    // Story 1.6 / AR9 / AR44: SSE stream relay. Subscribes to
    // ``coach:{conversationId}:{messageId}`` and forwards each PUBLISH as a
    // typed SSE event. Heartbeat comments every 15 s. Falls back to the
    // persisted row on Redis idle >30 s. SET ``coach:cancel:{messageId}``
    // when the client aborts so the worker can cancel mid-stream.
    private static async Task StreamMessage(
        Guid analysisId,
        Guid messageId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IConnectionMultiplexer redis,
        HttpContext httpCtx,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();

        // ── Ownership gate (AC6) — one join, projects only what we need. ──
        var row = await (
            from m in db.CoachMessages.AsNoTracking()
            join c in db.Conversations.AsNoTracking() on m.ConversationId equals c.Id
            join a in db.Analyses.AsNoTracking() on c.AnalysisId equals a.Id
            where m.Id == messageId
                && c.AnalysisId == analysisId
                && a.Id == analysisId
                && a.UserId == userId
            select new StreamMessageProjection(
                m.Id, m.Status, m.Content, m.Evidence, m.RefusalReason,
                c.Id)
        ).FirstOrDefaultAsync(ct);

        if (row is null)
        {
            httpCtx.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        SetSseHeaders(httpCtx);

        // Story 1.6 code review P1: subscribe FIRST, then re-read row
        // status. The actor's terminal-frame publish happens AFTER its
        // persist (story 1.6 code review P5); read-then-subscribe could
        // therefore observe row.Status='pending' at T-1, miss the publish
        // at T0, then sit idle until the 30 s fallback. Subscribing
        // before the re-read guarantees we catch any race-window publish.
        var channelName = new RedisChannel(
            $"coach:{row.ConversationId}:{row.MessageId}",
            RedisChannel.PatternMode.Literal);
        var sub = redis.GetSubscriber();

        // Story 1.6 code review P12: bounded channel + DropOldest gives a
        // hard upper bound on in-process buffering. Token frames are
        // ≲500 B; 1024 frames ≈ a long coach reply. If the SSE client
        // can't keep up, drop the oldest pending tokens — the persisted
        // row remains the source of truth for resume-on-refresh, and the
        // SSE consumer's accumulator stays in sync via the terminal
        // frame which carries the canonical body.
        var frames = Channel.CreateBounded<string>(
            new BoundedChannelOptions(1024)
            {
                SingleReader = true,
                SingleWriter = false,
                FullMode = BoundedChannelFullMode.DropOldest,
            });

        void Handler(RedisChannel _, RedisValue value)
        {
            var payload = value.ToString();
            if (!string.IsNullOrEmpty(payload))
                frames.Writer.TryWrite(payload);
        }

        await sub.SubscribeAsync(channelName, Handler);

        try
        {
            // Re-read AFTER subscribing — see comment above. If the row
            // is now terminal, the actor already wrote it; the in-flight
            // publish (if any) is in our channel but we discard it and
            // write the canonical synthesized form (AC5: one ``token``
            // carrying the persisted body, then ``done``/``refusal``/
            // ``error``). Mixing live + synthesized would duplicate.
            var refreshed = await ReadProjection(db, row.MessageId, ct);
            if (refreshed is not null && refreshed.Status != "pending")
            {
                await WriteTerminalFromRow(httpCtx, refreshed, ct);
                return;
            }

            await RelayLoop(httpCtx, db, redis, row, frames.Reader, ct);
        }
        finally
        {
            try { await sub.UnsubscribeAsync(channelName, Handler); } catch { /* best-effort */ }
            frames.Writer.TryComplete();

            // Client disconnect → flag the worker to stop generating mid-stream.
            // Best-effort; the TTL caps the lifetime of the cancel key so a
            // stale signal can't poison a future request that happens to reuse
            // the id (UUIDs collide with vanishing probability but the EX
            // guard costs nothing).
            if (ct.IsCancellationRequested)
            {
                try
                {
                    await redis.GetDatabase().StringSetAsync(
                        $"coach:cancel:{row.MessageId}", "1",
                        TimeSpan.FromSeconds(180));
                }
                catch { /* best-effort */ }
            }
        }
    }

    // Subscribe-loop: drains the frames channel; emits a heartbeat comment
    // every 15 s; falls back to the persisted row on >30 s idle.
    private static async Task RelayLoop(
        HttpContext httpCtx,
        AppDbContext db,
        IConnectionMultiplexer redis,
        StreamMessageProjection initialRow,
        ChannelReader<string> reader,
        CancellationToken ct)
    {
        var lastActivity = DateTime.UtcNow;
        var doneSeen = false;

        while (!ct.IsCancellationRequested && !doneSeen)
        {
            // Wait for EITHER a frame OR the heartbeat tick — whichever fires first.
            using var waitCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            var nextFrameTask = reader.ReadAsync(waitCts.Token).AsTask();
            var heartbeatTask = Task.Delay(StreamHeartbeatInterval, waitCts.Token);

            var winner = await Task.WhenAny(nextFrameTask, heartbeatTask);
            if (ct.IsCancellationRequested) break;

            if (winner == nextFrameTask)
            {
                string payload;
                try { payload = await nextFrameTask; }
                catch (ChannelClosedException) { break; }
                catch (OperationCanceledException) { break; }
                lastActivity = DateTime.UtcNow;
                waitCts.Cancel();  // stop the heartbeat timer
                // Story 1.6 code review P16: consume the cancellation
                // exception from heartbeatTask so it doesn't surface as
                // an UnobservedTaskException on the finalizer thread.
                try { await heartbeatTask; } catch (OperationCanceledException) { }
                doneSeen = await WritePublishedFrame(httpCtx, payload, ct);
                continue;
            }

            // Heartbeat fired → emit comment + check for idle-timeout.
            waitCts.Cancel();  // release the awaited Read
            // P16: same — consume the now-cancelled nextFrameTask.
            try { await nextFrameTask; } catch (OperationCanceledException) { } catch (ChannelClosedException) { }
            var idleFor = DateTime.UtcNow - lastActivity;
            if (idleFor >= StreamIdleTimeout)
            {
                // Idle fallback (AC4). Re-read the row — the actor may have
                // written terminal state without our subscribe seeing the
                // PUBLISH (Redis hiccup, slow subscribe, etc.).
                var refreshed = await ReadProjection(db, initialRow.MessageId, ct);
                if (refreshed is not null && refreshed.Status != "pending")
                {
                    await WriteTerminalFromRow(httpCtx, refreshed, ct);
                }
                else
                {
                    await WriteSseFrame(httpCtx, "error",
                        SerializeFrame(new
                        {
                            code = "coach_stream_idle",
                            message = "Coach stream went idle. Please refresh to retry.",
                        }), ct);
                }
                return;
            }

            await WriteSseComment(httpCtx, "heartbeat", ct);
        }
    }

    // Write one frame received from Redis pub/sub. Returns ``true`` when the
    // frame is terminal (``done`` / ``refusal`` / ``error``).
    private static async Task<bool> WritePublishedFrame(
        HttpContext httpCtx, string payload, CancellationToken ct)
    {
        // Defence in depth: bail on garbage payloads so a corrupt publish
        // can't crash the relay. The frame schema is enforced server-side
        // (worker), so this is purely a "don't crash" guard.
        string? type = null;
        try
        {
            using var doc = JsonDocument.Parse(payload);
            if (doc.RootElement.TryGetProperty("type", out var t) &&
                t.ValueKind == JsonValueKind.String)
            {
                type = t.GetString();
            }
        }
        catch (JsonException) { return false; }

        if (string.IsNullOrEmpty(type)) return false;

        await WriteSseFrame(httpCtx, type, payload, ct);

        // ``done`` / ``refusal`` / ``error`` are all terminal — the worker
        // never publishes anything after them on the same channel.
        return type is "done" or "refusal" or "error";
    }

    // Synthesize SSE frames for a row that's already terminalized — used
    // both for the resume-on-refresh short-circuit (AC5) and the idle
    // fallback (AC4).
    private static async Task WriteTerminalFromRow(
        HttpContext httpCtx, StreamMessageProjection row, CancellationToken ct)
    {
        // Emit one ``token`` frame with the full persisted content so the
        // consumer's accumulator ends up in the same state it would have
        // had if it had subscribed live.
        if (!string.IsNullOrEmpty(row.Content))
        {
            await WriteSseFrame(httpCtx, "token",
                SerializeFrame(new { text = row.Content }), ct);
        }

        switch (row.Status)
        {
            case "complete":
                var evidence = ParseEvidence(row.Evidence) ?? Array.Empty<CoachEvidenceDto>();
                await WriteSseFrame(httpCtx, "done",
                    SerializeFrame(new { evidence }), ct);
                break;
            case "refused":
                await WriteSseFrame(httpCtx, "refusal",
                    SerializeFrame(new
                    {
                        reason = row.RefusalReason ?? "out_of_scope",
                        body = row.Content,
                    }), ct);
                break;
            case "error":
            default:
                await WriteSseFrame(httpCtx, "error",
                    SerializeFrame(new
                    {
                        code = "coach_error",
                        message = string.IsNullOrEmpty(row.Content)
                            ? "Coach hit a transient error."
                            : row.Content,
                    }), ct);
                break;
        }
    }

    private static async Task<StreamMessageProjection?> ReadProjection(
        AppDbContext db, Guid messageId, CancellationToken ct)
    {
        return await db.CoachMessages.AsNoTracking()
            .Where(m => m.Id == messageId)
            .Join(db.Conversations.AsNoTracking(),
                m => m.ConversationId, c => c.Id,
                (m, c) => new StreamMessageProjection(
                    m.Id, m.Status, m.Content, m.Evidence,
                    m.RefusalReason, c.Id))
            .FirstOrDefaultAsync(ct);
    }

    private static void SetSseHeaders(HttpContext httpCtx)
    {
        httpCtx.Response.Headers["Content-Type"] = "text/event-stream";
        httpCtx.Response.Headers["Cache-Control"] = "no-cache";
        httpCtx.Response.Headers["X-Accel-Buffering"] = "no";
    }

    private static string SerializeFrame(object payload) =>
        JsonSerializer.Serialize(payload, StreamFrameJsonOpts);

    private static async Task WriteSseFrame(
        HttpContext httpCtx, string eventName, string dataPayload,
        CancellationToken ct)
    {
        // Defensive newline escaping — the worker emits single-line JSON but
        // a future field with newlines must not split the SSE frame. The
        // legacy /coach/{jobId}/chat handler uses the same convention.
        var encoded = dataPayload.Replace("\r\n", "\n").Replace("\n", "\\n");
        var frame = Encoding.UTF8.GetBytes($"event: {eventName}\ndata: {encoded}\n\n");
        try
        {
            await httpCtx.Response.Body.WriteAsync(frame, ct);
            await httpCtx.Response.Body.FlushAsync(ct);
        }
        catch (OperationCanceledException) { /* client gone — caller handles */ }
    }

    private static async Task WriteSseComment(
        HttpContext httpCtx, string comment, CancellationToken ct)
    {
        // SSE comment lines start with ``:`` and are ignored by EventSource
        // clients but reset the proxy idle timer.
        var frame = Encoding.UTF8.GetBytes($": {comment}\n\n");
        try
        {
            await httpCtx.Response.Body.WriteAsync(frame, ct);
            await httpCtx.Response.Body.FlushAsync(ct);
        }
        catch (OperationCanceledException) { /* client gone — caller handles */ }
    }

    // Minimal projection used by the stream endpoint — saves loading the
    // full CoachMessage entity (and avoids a tracked-entity write race
    // with the worker's UPDATE).
    // Story 1.6 code review P9: ``Content`` is nullable in EF (pending
    // rows have no content yet); the projection must match or LINQ
    // materialization can throw on a NULL hitting a non-nullable record
    // member.
    private sealed record StreamMessageProjection(
        Guid MessageId,
        string Status,
        string? Content,
        string? Evidence,
        string? RefusalReason,
        Guid ConversationId);
}
