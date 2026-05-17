using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using System.Security.Claims;
using System.Text;
using System.Text.Json;

namespace Spectr.Bff.Endpoints;

public static class CoachEndpoints
{
    public static IEndpointRouteBuilder MapCoachEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/coach").WithTags("coach").RequireAuthorization();

        g.MapGet("/{jobId:guid}", GetCoachView);
        g.MapPost("/{jobId:guid}/chat", PostChat);  // returns 503 until LLM stream lands

        return app;
    }

    // GET /api/coach/{jobId} — one-shot fetch of everything the Coach tab needs:
    // analysis blob, verdicts list, and pre-computed severity counts. Replaces
    // the current 3-round-trip pattern (analysis → verdicts → counts).
    private static async Task<IResult> GetCoachView(
        Guid jobId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var analysis = await db.Analyses.AsNoTracking()
            .FirstOrDefaultAsync(a => a.JobId == jobId && a.UserId == userId, ct);
        if (analysis is null) return Results.NotFound();

        var verdicts = await db.Verdicts.AsNoTracking()
            .Where(v => v.AnalysisId == analysis.Id)
            .OrderByDescending(v => v.PriorityScore)
            .ToListAsync(ct);

        var critical = verdicts.Count(v => v.Severity == "critical");
        var warning = verdicts.Count(v =>
            v.Severity == "severe" || v.Severity == "moderate");
        var info = verdicts.Count(v =>
            v.Severity == "minor" || v.Severity == "win" || v.Severity == "info");

        var slugsRun = verdicts
            .Where(v => v.Headline != "Specialist failed")
            .Select(v => v.Specialist)
            .ToHashSet();
        var specialistsRun = slugsRun.Count;
        var specialistsTotal = SpecialistCatalog.Slugs.Count;

        var verdictsArr = verdicts.Select(v => new
        {
            id = v.Id,
            specialist = v.Specialist,
            severity = v.Severity,
            category = v.Category,
            confidence = v.Confidence,
            priority_score = v.PriorityScore,
            headline = v.Headline,
            summary = v.Summary,
            metric_line = v.MetricLine,
        }).ToList();

        var verdictsJson = JsonDocument.Parse(JsonSerializer.Serialize(verdictsArr))
            .RootElement.Clone();
        var finalJson = ParseJson(analysis.FinalJson)
            ?? JsonDocument.Parse("{}").RootElement.Clone();

        return Results.Ok(new CoachViewDto(
            jobId, analysis.SongName, finalJson,
            specialistsRun, specialistsTotal,
            critical, warning, info,
            verdictsJson));
    }

    // POST /api/coach/{jobId}/chat
    //
    // SSE stream. Loads the analysis + verdicts, builds a system prompt that
    // tells the model exactly what it knows about this track, then invokes
    // the `claude` CLI via CoachChatService and forwards stdout chunks as
    // `event: chunk` frames. Ends with `event: done`.
    private static async Task PostChat(
        Guid jobId,
        CoachChatRequest body,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CoachChatService coach,
        HttpContext httpCtx,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body?.Message))
        {
            httpCtx.Response.StatusCode = 400;
            await httpCtx.Response.WriteAsJsonAsync(
                new { error = "message is required" }, ct);
            return;
        }

        var userId = currentUser.UserId();
        var analysis = await db.Analyses.AsNoTracking()
            .FirstOrDefaultAsync(a => a.JobId == jobId && a.UserId == userId, ct);
        if (analysis is null)
        {
            httpCtx.Response.StatusCode = 404;
            return;
        }

        var verdicts = await db.Verdicts.AsNoTracking()
            .Where(v => v.AnalysisId == analysis.Id)
            .OrderByDescending(v => v.PriorityScore)
            .Take(40)
            .Select(v => new
            {
                v.Specialist,
                v.Severity,
                v.Headline,
                v.Summary,
                v.MetricLine,
            })
            .ToListAsync(ct);

        var system = BuildSystemPrompt(analysis.SongName, analysis.FinalJson, verdicts);

        httpCtx.Response.Headers["Content-Type"] = "text/event-stream";
        httpCtx.Response.Headers["Cache-Control"] = "no-cache";
        httpCtx.Response.Headers["X-Accel-Buffering"] = "no";

        var timeout = TimeSpan.FromSeconds(120);
        await foreach (var chunk in coach.StreamAsync(system, body.Message, timeout, ct))
        {
            // SSE data field — strip newlines so multi-line chunks don't
            // terminate the frame prematurely. The frontend re-inserts
            // \n boundaries; chunks usually arrive without newlines anyway.
            var encoded = chunk.Replace("\r\n", "\n").Replace("\n", "\\n");
            var frame = Encoding.UTF8.GetBytes($"event: chunk\ndata: {encoded}\n\n");
            await httpCtx.Response.Body.WriteAsync(frame, ct);
            await httpCtx.Response.Body.FlushAsync(ct);
        }

        var doneFrame = Encoding.UTF8.GetBytes("event: done\ndata: {}\n\n");
        try { await httpCtx.Response.Body.WriteAsync(doneFrame, ct); } catch { }
    }

    // Compact system prompt — the model gets the full final_json and a
    // condensed verdict list so it can answer questions like "why am I
    // getting a B?" or "what should I fix first?" without hallucinating.
    private static string BuildSystemPrompt(
        string? songName,
        string finalJson,
        IEnumerable<object> verdicts)
    {
        var verdictBullets = string.Join("\n",
            verdicts.Select(v => $"  - {JsonSerializer.Serialize(v)}"));
        return $$"""
            You are SPECTR's AI Mix Coach. Your job is to answer the producer's
            questions about THIS specific track using ONLY the analysis data
            and verdict findings provided below. You cannot hear the audio.
            You cannot recommend specific plugin brands. You CAN explain what
            specialists found, what to fix first, and why a particular metric
            matters.

            Track: {{songName ?? "Untitled"}}

            ## Analysis (final_json)

            ```json
            {{finalJson}}
            ```

            ## Specialist findings (top 40 by priority)

            {{verdictBullets}}

            ## Rules

            - Be concise: 1-3 short paragraphs unless the user explicitly asks
              for detail.
            - Cite metric values when relevant (e.g. "you're hitting -11.2
              LUFS but Spotify normalizes to -14").
            - If the answer requires hearing the audio, say so honestly and
              suggest running an unrun specialist.
            - Never invent metrics that aren't in the data above.
            """;
    }

    private static JsonElement? ParseJson(string? raw)
    {
        if (string.IsNullOrEmpty(raw)) return null;
        try
        {
            using var doc = JsonDocument.Parse(raw);
            return doc.RootElement.Clone();
        }
        catch (JsonException) { return null; }
    }
}
