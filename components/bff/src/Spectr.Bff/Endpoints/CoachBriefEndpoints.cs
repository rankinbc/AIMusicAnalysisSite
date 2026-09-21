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
            .Select(a => new { a.Id, a.RoutingPlan, a.VersionId })
            .FirstOrDefaultAsync(ct);
        if (analysis is null) return Results.NotFound();

        // Triage hasn't produced a routing plan yet — nothing grounded to
        // brief on. The frontend retries once the report finishes.
        if (analysis.RoutingPlan is null)
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
        // a second LLM call.
        var existing = await FindExistingBriefAsync(db, conversation.Id, ct);
        if (existing is not null)
            return Results.Ok(new CoachBriefResponse("exists", existing));

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
            return Results.Ok(new CoachBriefResponse("exists", winner));
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

    private static async Task<Guid?> FindExistingBriefAsync(
        AppDbContext db, Guid conversationId, CancellationToken ct)
        => await db.CoachMessages.AsNoTracking()
            .Where(m => m.ConversationId == conversationId
                && m.Role == "assistant" && m.Mode == CoachBrief.Mode)
            .Select(m => (Guid?)m.Id)
            .FirstOrDefaultAsync(ct);
}
