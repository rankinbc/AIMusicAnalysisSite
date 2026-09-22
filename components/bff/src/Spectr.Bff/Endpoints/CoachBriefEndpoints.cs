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
    //
    // Fix round 2 item 2: this MUST safely exceed the worst-case duration a
    // LEGITIMATELY in-flight generation can take, not just equal the
    // worker's inner call timeout — otherwise a retry can reset (and
    // re-enqueue) a row that is still being generated, producing two
    // concurrent `coach_reply` invocations against the same message id
    // (double LLM spend + interleaved SSE token frames on one Redis
    // channel). The worker-side numbers this must stay safely ahead of
    // (components/worker/app/coach_actor.py — do not edit that file here,
    // just keep this comment in sync with it):
    //   - line 339: `time_limit=180_000` — 180s, the max wall-clock time
    //     dramatiq allows ONE actor attempt before killing it.
    //   - line 338: `max_retries=1` — dramatiq may run the actor a SECOND
    //     time after the first attempt fails/times out, plus its own retry
    //     backoff delay between attempts.
    //   - line 609: `timeout_s=120` — the LLM call's own timeout, which is
    //     WITHIN a single 180s attempt, so it never adds on top of it.
    // Worst case a legitimate generation can take: 2 attempts x 180s = 360s,
    // plus dramatiq's retry backoff margin. 600s (10 min) clears that with
    // real headroom, unlike the old 120s value (equal to the inner
    // timeout_s, zero margin). `internal` (not `private`) so
    // Spectr.Bff.Tests can pin this exact value instead of a duplicated
    // literal (InternalsVisibleTo("Spectr.Bff.Tests") in the csproj).
    internal const int StalenessWindowSeconds = 600;

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
            var resetNow = DateTimeOffset.UtcNow;
            var cutoff = resetNow.AddSeconds(-StalenessWindowSeconds);
            var isStalePending = existing.Status is "pending" or "streaming"
                && existing.CreatedAt < cutoff;
            var isBroken = existing.Status == "error" || isStalePending;

            if (!isBroken)
                return Results.Ok(new CoachBriefResponse("exists", existing.AssistantId));

            // Fix round 2 item 1: race-safe reset. The conditional
            // ExecuteUpdateAsync below is the ONLY race guard — only the
            // caller whose UPDATE affects exactly 1 row gets to re-enqueue.
            // For the `error` branch this was already correct on its own:
            // the winner flips `status` away from 'error', so a loser's
            // re-evaluated WHERE sees a non-error row and (given a fresh
            // CreatedAt) matches 0 rows.
            // For the `pending`/`streaming`-staleness branch this was NOT
            // correct before this fix: the SET never advanced `CreatedAt`,
            // so after the winning reset the row was STILL `status =
            // 'pending'` with the SAME stale `CreatedAt` — a loser's
            // re-evaluated WHERE matched again and it ALSO enqueued (and an
            // aged `error` row had the identical problem one hop later,
            // once the winner's reset turned it into a stale `pending`
            // row). Fix: the SET must also refresh `CreatedAt` to `now` in
            // the SAME statement. There's no separate "last enqueued at"
            // column and we're not adding one — a brief's `CreatedAt` IS
            // its "last enqueue" moment already (it's set to `now` on the
            // initial create too, a few lines below this block), so
            // reusing it here just keeps that invariant true across a
            // reset. That's what makes the staleness predicate stop
            // matching for every subsequent racer once one caller wins,
            // and it's also what restarts the staleness clock for the next
            // legitimate retry window.
            var resetCount = await db.CoachMessages
                .Where(m => m.Id == existing.AssistantId
                    && (m.Status == "error" || m.Status == "pending" || m.Status == "streaming")
                    && (m.Status == "error" || m.CreatedAt < cutoff))
                .ExecuteUpdateAsync(s => s
                    .SetProperty(m => m.Status, "pending")
                    .SetProperty(m => m.Content, string.Empty)
                    .SetProperty(m => m.RefusalReason, (string?)null)
                    .SetProperty(m => m.CompletedAt, (DateTimeOffset?)null)
                    .SetProperty(m => m.CreatedAt, resetNow), ct);

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
