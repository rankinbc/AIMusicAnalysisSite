using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Security.Claims;

namespace Spectr.Bff.Endpoints;

// Task G3 (spec G-D3) — the coach opens each report with a brief: findings,
// fixes, top three priorities, then (guests only) a read-time invitation to
// create an account. The brief rides the EXISTING coach_reply actor through a
// server-authored trigger row in a new "brief" mode — no new worker wire
// format, no new LLM plumbing. Open to guests (`.AllowGuest()`): the whole
// point is a guest's first report gets the full product, coach included.
public static class CoachBriefEndpoints
{
    // Fix round 1 item 2 (IMPORTANT): how long a `pending`/`streaming`
    // assistant row can sit unresolved before a new POST treats it as
    // broken (the worker lost the message) and re-enqueues rather than
    // answering `exists` forever. An `error` row is always broken
    // regardless of age (see the reset predicate below).
    private const int StalenessWindowSeconds = 120;

    public static IEndpointRouteBuilder MapCoachBriefEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGroup("/coach/{analysisId:guid}")
            .WithTags("coach-brief")
            .RequireAuthorization()
            .MapPost("/brief", Post)
            .AllowGuest();

        return app;
    }

    // POST /api/coach/{analysisId}/brief
    private static async Task<IResult> Post(
        Guid analysisId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IJobQueue queue,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();

        var analysis = await db.Analyses.AsNoTracking()
            .Where(a => a.Id == analysisId && a.UserId == userId)
            .Select(a => new { a.Id, a.RoutingPlan, a.DegradationNotice, a.VersionId })
            .FirstOrDefaultAsync(ct);
        if (analysis is null) return Results.NotFound();

        // Fix round 1 item 1: "ready" means triage EITHER produced a
        // routing plan OR terminally degraded — a degraded analysis never
        // gets a routing plan, but it's a terminal state, not "still
        // working". Same predicate VerdictEndpoints uses so the two never
        // drift. The frontend retries once the report finishes.
        if (!VerdictEndpoints.IsReadyForCoach(analysis.RoutingPlan, analysis.DegradationNotice))
        {
            return ErrorEnvelope.Build(
                StatusCodes.Status409Conflict,
                "brief_not_ready",
                "The analysis isn't ready for a coach brief yet — try again shortly.");
        }

        // The seeded demo/showcase version never gets a live brief — there's
        // no real progress to save and no guest to invite.
        var isDemoVersion = analysis.VersionId is not null
            && await db.SongVersions.AsNoTracking()
                .Where(v => v.Id == analysis.VersionId)
                .Select(v => v.FilePath)
                .AnyAsync(fp => fp.StartsWith("audio/demo/"), ct);
        if (isDemoVersion)
            return Results.Ok(new CoachBriefResponse("skipped", null));

        var conversation = await CoachConversationEndpoints.GetOrCreateConversationAsync(
            db, analysisId, userId, ct);

        // Idempotent: a brief already exists (this call's own re-check, or a
        // concurrent request that already committed) — converge on it, never
        // a second LLM call. Fix round 1 item 2: UNLESS that existing brief
        // is broken (enqueue failed after commit → `error`, or the worker
        // lost the message → stuck `pending`/`streaming` past the
        // staleness window) — then re-enqueue instead of answering `exists`
        // forever.
        var existing = await FindExistingBriefAsync(db, conversation.Id, ct);
        if (existing is not null)
        {
            var cutoff = DateTimeOffset.UtcNow.AddSeconds(-StalenessWindowSeconds);
            var isStalePending = existing.Status is "pending" or "streaming"
                && existing.CreatedAt < cutoff;
            var isBroken = existing.Status == "error" || isStalePending;

            if (!isBroken)
                return Results.Ok(new CoachBriefResponse("exists", existing.AssistantId));

            // Race-safe reset: only the caller whose conditional
            // ExecuteUpdateAsync affects exactly 1 row gets to re-enqueue.
            // A concurrent winner flips status away from 'error' (or the
            // staleness predicate stops matching once state's `pending`
            // again without a stale CreatedAt to re-trip it), so a losing
            // caller's UPDATE affects 0 rows and it just converges on
            // `exists` — no double enqueue.
            var resetCount = await db.CoachMessages
                .Where(m => m.Id == existing.AssistantId
                    && (m.Status == "error" || m.Status == "pending" || m.Status == "streaming")
                    && (m.Status == "error" || m.CreatedAt < cutoff))
                .ExecuteUpdateAsync(s => s
                    .SetProperty(m => m.Status, "pending")
                    .SetProperty(m => m.Content, string.Empty)
                    .SetProperty(m => m.RefusalReason, (string?)null)
                    .SetProperty(m => m.CompletedAt, (DateTimeOffset?)null), ct);

            if (resetCount != 1)
                return Results.Ok(new CoachBriefResponse("exists", existing.AssistantId));

            try
            {
                await queue.EnqueueAsync(
                    DramatiqTasks.CoachReply,
                    new object[]
                    {
                        conversation.Id.ToString(),
                        existing.UserId.ToString(),
                        existing.AssistantId.ToString(),
                    },
                    DramatiqQueues.Coach,
                    ct);
            }
            catch (Exception)
            {
                // Enqueue failed right after our own reset — mark it
                // `error` again so the NEXT POST can retry rather than
                // leaving it stuck `pending` with nothing behind it.
                await db.CoachMessages.Where(m => m.Id == existing.AssistantId)
                    .ExecuteUpdateAsync(s => s
                        .SetProperty(m => m.Status, "error")
                        .SetProperty(m => m.Content, "The coach hit a transient error. Please try again.")
                        .SetProperty(m => m.CompletedAt, DateTimeOffset.UtcNow), ct);
                return ErrorEnvelope.Build(
                    StatusCodes.Status503ServiceUnavailable,
                    "coach_queue_unavailable",
                    "Coach queue is temporarily unavailable. Please try again.");
            }

            return Results.Json(
                new CoachBriefResponse("retried", existing.AssistantId),
                statusCode: StatusCodes.Status202Accepted);
        }

        var now = DateTimeOffset.UtcNow;
        // The trigger row is a fixed, server-authored instruction — never
        // producer text. It rides the SAME coach_reply actor as an ordinary
        // turn so no new worker wire format is needed; read paths hide it
        // (CoachConversationEndpoints.GetConversation) and it is never
        // metered (no usage_event is written below).
        var userRow = new CoachMessage
        {
            Id = Guid.NewGuid(),
            ConversationId = conversation.Id,
            Role = "user",
            Status = "complete",
            Mode = CoachBrief.Mode,
            Content = CoachBrief.Instruction,
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
            Mode = CoachBrief.Mode,
            Content = string.Empty,
            Evidence = null,
            RefusalReason = null,
            LlmCallId = null,
            CreatedAt = now.AddMilliseconds(1),
            CompletedAt = null,
        };
        db.CoachMessages.Add(userRow);
        db.CoachMessages.Add(assistantRow);

        try
        {
            // NO usage_event here (unlike PostMessage) — a brief must never
            // count against the guest cap or the pro/free coach meters.
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // The partial unique index (ux_coach_messages_brief) caught a
            // concurrent winner. Detach our draft rows and re-read theirs.
            db.Entry(userRow).State = EntityState.Detached;
            db.Entry(assistantRow).State = EntityState.Detached;
            var winner = await FindExistingBriefAsync(db, conversation.Id, ct);
            if (winner is null) throw;
            return Results.Ok(new CoachBriefResponse("exists", winner.AssistantId));
        }

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
            return ErrorEnvelope.Build(
                StatusCodes.Status503ServiceUnavailable,
                "coach_queue_unavailable",
                "Coach queue is temporarily unavailable. Please try again.");
        }

        return Results.Json(
            new CoachBriefResponse("created", assistantRow.Id),
            statusCode: StatusCodes.Status202Accepted);
    }

    // Fix round 1 item 2: carries enough to decide "broken" (Status,
    // CreatedAt) and to re-enqueue against the SAME trigger pair (UserId)
    // without a second lookup.
    private sealed record ExistingBrief(Guid AssistantId, Guid UserId, string Status, DateTimeOffset CreatedAt);

    private static async Task<ExistingBrief?> FindExistingBriefAsync(
        AppDbContext db, Guid conversationId, CancellationToken ct)
    {
        var assistant = await db.CoachMessages.AsNoTracking()
            .Where(m => m.ConversationId == conversationId
                && m.Role == "assistant" && m.Mode == CoachBrief.Mode)
            .Select(m => new { m.Id, m.Status, m.CreatedAt })
            .FirstOrDefaultAsync(ct);
        if (assistant is null) return null;

        var userId = await db.CoachMessages.AsNoTracking()
            .Where(m => m.ConversationId == conversationId
                && m.Role == "user" && m.Mode == CoachBrief.Mode)
            .Select(m => m.Id)
            .FirstOrDefaultAsync(ct);

        return new ExistingBrief(assistant.Id, userId, assistant.Status, assistant.CreatedAt);
    }
}
