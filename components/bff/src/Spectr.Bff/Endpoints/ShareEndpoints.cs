using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;

namespace Spectr.Bff.Endpoints;

public static class ShareEndpoints
{
    public static IEndpointRouteBuilder MapShareEndpoints(this IEndpointRouteBuilder app)
    {
        // Producer-side share-link management (authed)
        var owner = app.MapGroup("/analyses/{analysisId:guid}/share")
            .WithTags("share").RequireAuthorization();
        owner.MapPost("/", CreateShare);
        owner.MapPatch("/", PatchShare);
        owner.MapDelete("/", RevokeShare);

        // Public share-link consumption (anonymous reviewer)
        var pub = app.MapGroup("/share/{token}").WithTags("share").AllowAnonymous();
        pub.MapGet("/", GetShared);
        pub.MapGet("/audio", StreamShareAudio);
        pub.MapGet("/peaks", GetSharePeaks);
        pub.MapGet("/comments", GetShareComments);
        pub.MapPost("/comments", PostShareComment);

        return app;
    }

    // ── Owner endpoints ─────────────────────────────────────────────────────

    private static async Task<IResult> CreateShare(
        Guid analysisId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var analysis = await db.Analyses
            .FirstOrDefaultAsync(a => a.Id == analysisId && a.UserId == userId, ct);
        if (analysis is null) return Results.NotFound();

        if (string.IsNullOrEmpty(analysis.ShareToken))
        {
            // Token is URL-safe base64 of 24 random bytes — 32 chars, fits the
            // VARCHAR(36) column with room for any future hyphen-formatting.
            analysis.ShareToken = GenerateToken();
            analysis.ShareEnabledAt = DateTimeOffset.UtcNow;
        }
        await db.SaveChangesAsync(ct);

        return Results.Ok(new CreateShareResponse(
            analysis.ShareToken!,
            analysis.ShareShowVerdicts,
            analysis.ShareEnabledAt ?? DateTimeOffset.UtcNow,
            $"/r/{analysis.ShareToken}"));
    }

    private static async Task<IResult> PatchShare(
        Guid analysisId,
        PatchShareRequest body,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var analysis = await db.Analyses
            .FirstOrDefaultAsync(a => a.Id == analysisId && a.UserId == userId, ct);
        if (analysis is null) return Results.NotFound();
        analysis.ShareShowVerdicts = body.ShowVerdicts;
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    private static async Task<IResult> RevokeShare(
        Guid analysisId,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var analysis = await db.Analyses
            .FirstOrDefaultAsync(a => a.Id == analysisId && a.UserId == userId, ct);
        if (analysis is null) return Results.NotFound();
        analysis.ShareToken = null;
        analysis.ShareEnabledAt = null;
        analysis.ShareShowVerdicts = false;
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    // ── Public endpoints ────────────────────────────────────────────────────

    private static async Task<IResult> GetShared(
        string token,
        AppDbContext db,
        CancellationToken ct)
    {
        var hit = await (
            from a in db.Analyses.AsNoTracking()
            join u in db.Users.AsNoTracking() on a.UserId equals u.Id
            where a.ShareToken == token
            select new { a, u.Handle, u.DisplayName }
        ).FirstOrDefaultAsync(ct);
        if (hit is null) return Results.NotFound();

        // Verdicts piggy-back on the analysis row via a separate query so
        // the JSON projection stays simple. show_verdicts controls visibility.
        JsonElement? verdictsJson = null;
        if (hit.a.ShareShowVerdicts)
        {
            var verdicts = await db.Verdicts.AsNoTracking()
                .Where(v => v.AnalysisId == hit.a.Id)
                .OrderByDescending(v => v.PriorityScore)
                .ToListAsync(ct);
            // Strip per-user dismissal state — public viewers don't see it.
            // Each verdict's JSON columns (evidence/fix/sources) are emitted
            // as JsonElement to avoid double-encoding.
            var arr = verdicts.Select(v => new
            {
                id = v.Id,
                specialist = v.Specialist,
                severity = v.Severity,
                category = v.Category,
                confidence = v.Confidence,
                priority_score = v.PriorityScore,
                impact = v.Impact,
                headline = v.Headline,
                summary = v.Summary,
                body = v.Body,
                metric_line = v.MetricLine,
                why_it_matters = v.WhyItMatters,
                evidence = ParseJson(v.Evidence),
                fix = ParseJson(v.Fix),
                sources = ParseJson(v.Sources),
                created_at = v.CreatedAt,
            }).ToList();
            verdictsJson = JsonDocument.Parse(JsonSerializer.Serialize(arr)).RootElement.Clone();
        }

        var finalJson = ParseJson(hit.a.FinalJson)
            ?? JsonDocument.Parse("{}").RootElement.Clone();

        return Results.Ok(new SharedAnalysisDto(
            token,
            hit.a.SongName,
            hit.Handle,
            hit.DisplayName,
            hit.a.CreatedAt,
            finalJson,
            verdictsJson));
    }

    private static async Task<IResult> StreamShareAudio(
        string token,
        AppDbContext db,
        IFileStorage storage,
        CancellationToken ct)
    {
        // Resolve token → analysis → version → file. Same Range-friendly
        // streaming as /api/versions/{id}/audio but without auth (the
        // share_token IS the access grant).
        var versionId = await (
            from a in db.Analyses.AsNoTracking()
            where a.ShareToken == token
            select a.VersionId).FirstOrDefaultAsync(ct);
        if (versionId is null) return Results.NotFound();
        var key = await db.SongVersions.AsNoTracking()
            .Where(v => v.Id == versionId)
            .Select(v => v.FilePath)
            .FirstOrDefaultAsync(ct);
        if (string.IsNullOrEmpty(key)) return Results.NotFound();
        if (!await storage.ExistsAsync(key, ct)) return Results.NotFound();

        var stream = await storage.OpenReadAsync(key, ct);
        var ext = Path.GetExtension(key).ToLowerInvariant();
        var contentType = ext switch
        {
            ".wav" => "audio/wav",
            ".flac" => "audio/flac",
            ".mp3" => "audio/mpeg",
            ".aif" or ".aiff" => "audio/aiff",
            ".ogg" or ".oga" => "audio/ogg",
            ".m4a" => "audio/mp4",
            _ => "application/octet-stream",
        };
        return Results.File(stream, contentType, enableRangeProcessing: true);
    }

    private static async Task<IResult> GetSharePeaks(
        string token,
        AppDbContext db,
        IFileStorage storage,
        CancellationToken ct)
    {
        var peaksKey = await (
            from a in db.Analyses.AsNoTracking()
            where a.ShareToken == token
            select a.WaveformPeaksPath
        ).FirstOrDefaultAsync(ct);
        // Waveform peaks generation is a future slice; respond 404 cleanly
        // until the producer-side waveform-peaks pipeline lands.
        if (string.IsNullOrEmpty(peaksKey)) return Results.NotFound();
        if (!await storage.ExistsAsync(peaksKey, ct)) return Results.NotFound();
        var stream = await storage.OpenReadAsync(peaksKey, ct);
        return Results.File(stream, "application/json");
    }

    private static async Task<IResult> GetShareComments(
        string token,
        AppDbContext db,
        CancellationToken ct)
    {
        var exists = await db.Analyses.AsNoTracking()
            .AnyAsync(a => a.ShareToken == token, ct);
        if (!exists) return Results.NotFound();
        var rows = await db.TrackComments.AsNoTracking()
            .Where(c => c.TargetShareToken == token && c.DeletedAt == null)
            .OrderBy(c => c.CreatedAt)
            .Select(c => new ShareCommentDto(
                c.Id, c.AuthorDisplayName, c.TimestampSeconds, c.Body, c.CreatedAt))
            .ToListAsync(ct);
        return Results.Ok(rows);
    }

    private static async Task<IResult> PostShareComment(
        string token,
        PostShareCommentRequest body,
        AppDbContext db,
        HttpContext httpCtx,
        CancellationToken ct)
    {
        var bodyText = (body.Body ?? "").Trim();
        if (string.IsNullOrEmpty(bodyText))
            return Results.BadRequest(new { error = "Body is required." });
        if (bodyText.Length > 2000)
            return Results.BadRequest(new { error = "Body exceeds 2000 chars." });

        var exists = await db.Analyses.AsNoTracking()
            .AnyAsync(a => a.ShareToken == token, ct);
        if (!exists) return Results.NotFound();

        // Hash the requester's IP so we can rate-limit / spam-detect later
        // without storing raw IPs. Salt is per-process; on restart the hashes
        // change, which is fine — this is for short-window dedupe, not
        // long-term tracking.
        var ip = httpCtx.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var hash = SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(ip));

        var row = new TrackComment
        {
            Id = Guid.NewGuid(),
            TargetShareToken = token,
            Body = bodyText,
            TimestampSeconds = body.TimestampSeconds,
            AuthorDisplayName = string.IsNullOrWhiteSpace(body.AuthorDisplayName)
                ? null
                : body.AuthorDisplayName.Trim()[..Math.Min(120, body.AuthorDisplayName.Trim().Length)],
            AuthorIpHash = hash,
        };
        db.TrackComments.Add(row);
        await db.SaveChangesAsync(ct);
        return Results.Created($"/api/share/{token}/comments/{row.Id}",
            new ShareCommentDto(row.Id, row.AuthorDisplayName, row.TimestampSeconds, row.Body, row.CreatedAt));
    }

    // ── helpers ──────────────────────────────────────────────────────────────
    private static string GenerateToken()
    {
        var buf = RandomNumberGenerator.GetBytes(24);
        return Convert.ToBase64String(buf).Replace('+', '-').Replace('/', '_').TrimEnd('=');
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
