using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Security.Claims;
using System.Text.Json;

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
}
