using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Spectr.Bff.Options;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Spectr.Bff.Endpoints;

// Story 4.2 (AC3/AR27) — Resend delivery webhooks. Resend signs via Svix:
// HMAC-SHA256 over "{svix-id}.{svix-timestamp}.{body}" with the base64
// whsec_ secret; svix-signature carries space-delimited "v1,<base64>"
// entries. No in-repo Svix helper (Stripe's EventUtility doesn't apply), so
// the verifier below is custom: constant-time compare + ±5 min timestamp
// window. Dedupe rides the existing webhook_events pattern (story 2.1 rule:
// INSERT ON CONFLICT DO NOTHING + conditional processed_at skip).
public static class EmailWebhookEndpoints
{
    private static readonly TimeSpan TimestampTolerance = TimeSpan.FromMinutes(5);

    public static void MapEmailWebhookEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/email/webhook", HandleWebhook).AllowAnonymous();
    }

    private static async Task<IResult> HandleWebhook(
        HttpRequest request,
        AppDbContext db,
        IOptions<ResendOptions> options,
        ILoggerFactory loggerFactory,
        CancellationToken ct)
    {
        var logger = loggerFactory.CreateLogger("EmailWebhook");
        var secret = options.Value.WebhookSecret;
        if (string.IsNullOrWhiteSpace(secret))
            // Never process unsigned events; 503 tells Resend to retry once
            // the secret is configured (Stripe-webhook precedent).
            return Results.StatusCode(503);

        using var reader = new StreamReader(request.Body, Encoding.UTF8);
        var body = await reader.ReadToEndAsync(ct);

        var svixId = request.Headers["svix-id"].ToString();
        var svixTimestamp = request.Headers["svix-timestamp"].ToString();
        var svixSignature = request.Headers["svix-signature"].ToString();
        if (string.IsNullOrEmpty(svixId) || string.IsNullOrEmpty(svixTimestamp)
            || string.IsNullOrEmpty(svixSignature))
            return Results.Unauthorized();

        if (!long.TryParse(svixTimestamp, out var unix)
            || Math.Abs((DateTimeOffset.UtcNow - DateTimeOffset.FromUnixTimeSeconds(unix)).TotalMinutes)
               > TimestampTolerance.TotalMinutes)
            return Results.Unauthorized();

        if (!VerifySvixSignature(secret, svixId, svixTimestamp, body, svixSignature))
            return Results.Unauthorized();

        // ── Dedupe (webhook_events, story 2.1 pattern) ───────────────────────
        var payloadHash = Convert.ToHexString(
            SHA256.HashData(Encoding.UTF8.GetBytes(body))).ToLowerInvariant();
        string eventType;
        string? email;
        try
        {
            using var doc = JsonDocument.Parse(body);
            eventType = doc.RootElement.GetProperty("type").GetString() ?? "";
            email = ExtractRecipient(doc.RootElement);
        }
        catch (JsonException)
        {
            return Results.BadRequest();
        }

        var inserted = await db.Database.ExecuteSqlInterpolatedAsync($@"
            INSERT INTO webhook_events (id, event_type, payload_hash, received_at)
            VALUES ({svixId}, {eventType}, {payloadHash}, now())
            ON CONFLICT (id) DO NOTHING", ct);
        if (inserted == 0)
        {
            var processedAt = await db.WebhookEvents.AsNoTracking()
                .Where(w => w.Id == svixId)
                .Select(w => w.ProcessedAt)
                .FirstOrDefaultAsync(ct);
            if (processedAt is not null)
                return Results.Ok(new { duplicate = true });
            // else: first dispatch failed — fall through and reprocess.
        }

        try
        {
            if (eventType is "email.bounced" or "email.complained"
                && !string.IsNullOrWhiteSpace(email))
            {
                var reason = eventType == "email.bounced" ? "bounced" : "complained";
                var normalized = email.Trim().ToLowerInvariant();
                await db.Database.ExecuteSqlInterpolatedAsync($@"
                    INSERT INTO email_suppressions (email, reason, source_event_id, created_at)
                    VALUES ({normalized}, {reason}, {svixId}, now())
                    ON CONFLICT (email) DO NOTHING", ct);
                logger.LogWarning(
                    "Email suppression appended: reason={Reason} event={EventId}",
                    reason, svixId);
            }

            await db.Database.ExecuteSqlInterpolatedAsync($@"
                UPDATE webhook_events SET processed_at = now(), processing_error = NULL
                WHERE id = {svixId}", ct);
            return Results.Ok(new { received = true });
        }
        catch (Exception ex)
        {
            var sanitized = ex.GetType().Name + ": " + ex.Message;
            if (sanitized.Length > 2000) sanitized = sanitized[..2000];
            await db.Database.ExecuteSqlInterpolatedAsync($@"
                UPDATE webhook_events SET processing_error = {sanitized}
                WHERE id = {svixId}", CancellationToken.None);
            throw; // 5xx → Resend retries; the dedupe row reprocesses next time
        }
    }

    // Resend payload: { type, created_at, data: { to: ["a@b"], email_id, ... } }
    private static string? ExtractRecipient(JsonElement root)
    {
        if (!root.TryGetProperty("data", out var data)) return null;
        if (data.TryGetProperty("to", out var to))
        {
            if (to.ValueKind == JsonValueKind.Array && to.GetArrayLength() > 0)
                return to[0].GetString();
            if (to.ValueKind == JsonValueKind.String)
                return to.GetString();
        }
        return null;
    }

    internal static bool VerifySvixSignature(
        string secret, string id, string timestamp, string body, string signatureHeader)
    {
        var key = Convert.FromBase64String(
            secret.StartsWith("whsec_", StringComparison.Ordinal) ? secret[6..] : secret);
        var signedContent = $"{id}.{timestamp}.{body}";
        var expected = HMACSHA256.HashData(key, Encoding.UTF8.GetBytes(signedContent));

        // Header: space-delimited list of "v1,<base64>" entries.
        foreach (var entry in signatureHeader.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            var parts = entry.Split(',', 2);
            if (parts.Length != 2 || parts[0] != "v1") continue;
            byte[] provided;
            try { provided = Convert.FromBase64String(parts[1]); }
            catch (FormatException) { continue; }
            if (provided.Length == expected.Length
                && CryptographicOperations.FixedTimeEquals(provided, expected))
                return true;
        }
        return false;
    }
}
