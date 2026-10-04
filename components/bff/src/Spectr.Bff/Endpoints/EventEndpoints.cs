using System.Text.Json;
using System.Text.RegularExpressions;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;

namespace Spectr.Bff.Endpoints;

// F1b — POST /api/events: the first-party analytics sink (see AnalyticsEvent).
//
// Anonymous by necessity — the top of the funnel is visitors with no account.
// It is WRITE-ONLY and always answers 204 with no body, so a caller learns
// nothing about other accounts or site load (the solo-fork test). Everything
// in the body is untrusted:
//   • unknown event names are dropped (no arbitrary strings into the table);
//   • the body is size-capped and parsed tolerantly — a bad body is a no-op;
//   • path keeps no query string; props keep only short primitives;
//   • attribution goes through the F1 sanitizer;
//   • a per-IP rate limit bounds abuse, and a limiter failure DROPS the event
//     (unlike auth, losing an analytics row is the cheap side to fail on).
// No IP address or user agent is stored.
public static partial class EventEndpoints
{
    private const int BodyMaxBytes = 4096;
    private const int PerMinutePerIp = 120;
    private const int MaxProps = 8;
    private const int MaxPropString = 64;

    // Mirror of the frontend EventName union (lib/analytics.ts) plus
    // page_viewed. Parity is enforced by the frontend test
    // lib/__tests__/first-party-events-parity.test.ts.
    public static readonly HashSet<string> KnownEvents = new(StringComparer.Ordinal)
    {
        "page_viewed",
        "upload_completed", "report_viewed", "coach_message_sent", "verdict_feedback",
        "landing_viewed", "features_viewed", "analyze_started", "analyze_completed", "report_claimed",
        "pricing_viewed", "checkout_started", "resume_shown", "resume_clicked",
        "demo_cta_clicked", "demo_started", "demo_start_failed", "demo_signup_clicked",
        "demo_guest_restricted", "engineering_viewed",
        "guest_upload_started", "guest_converted", "guest_signup_clicked", "signup_cta_clicked",
        "signup_completed", "email_verified", "purchase_completed",
    };

    [GeneratedRegex("^[A-Za-z0-9-]{8,36}$")]
    private static partial Regex SessionIdPattern();

    [GeneratedRegex("^[a-z0-9_]{1,32}$")]
    private static partial Regex PropKeyPattern();

    [GeneratedRegex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")]
    private static partial Regex GuidPattern();

    public static IEndpointRouteBuilder MapEventEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/events", Post).AllowAnonymous().WithTags("events");
        return app;
    }

    private static async Task<IResult> Post(
        HttpContext http, AppDbContext db, IRateLimiter limiter, IConfiguration cfg,
        ILoggerFactory loggerFactory, CancellationToken ct)
    {
        try
        {
            if (!await AllowedAsync(http, limiter, cfg, ct)) return Results.NoContent();
            if (await ReadAsync(http, ct) is not { } row) return Results.NoContent();
            db.AnalyticsEvents.Add(row);
            await db.SaveChangesAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Analytics must never surface an error to a visitor.
            loggerFactory.CreateLogger("Events").LogWarning(ex, "analytics event dropped");
        }
        return Results.NoContent();
    }

    private static async Task<bool> AllowedAsync(
        HttpContext http, IRateLimiter limiter, IConfiguration cfg, CancellationToken ct)
    {
        if (string.Equals(cfg["RateLimits:Enabled"], "false", StringComparison.OrdinalIgnoreCase))
            return true;
        var ip = AuthEndpoints.ClientIp(http);
        var verdict = await limiter.CheckAsync(
            $"ip:{ip}", ip, "events", PerMinutePerIp, TimeSpan.FromMinutes(1), ct);
        return verdict.Allowed;
    }

    private static async Task<AnalyticsEvent?> ReadAsync(HttpContext http, CancellationToken ct)
    {
        var req = http.Request;
        if (!req.HasJsonContentType() || req.ContentLength > BodyMaxBytes) return null;
        var buf = new byte[BodyMaxBytes + 1];
        var read = 0;
        while (read < buf.Length)
        {
            var n = await req.Body.ReadAsync(buf.AsMemory(read), ct);
            if (n == 0) break;
            read += n;
        }
        if (read == 0 || read > BodyMaxBytes) return null;

        JsonDocument doc;
        try { doc = JsonDocument.Parse(buf.AsMemory(0, read)); }
        catch (JsonException) { return null; }
        using (doc)
        {
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;
            if (Str(root, "event") is not { } name || !KnownEvents.Contains(name)) return null;

            var attribution = root.TryGetProperty("attribution", out var a) && a.ValueKind == JsonValueKind.Object
                ? SignupAttributionWriter.Clean(
                    new SignupAttribution(Str(a, "source"), Str(a, "medium"), Str(a, "campaign"), Str(a, "referrer")),
                    req.Host.Host)
                : null;

            Guid? userId = null;
            if (http.User.Identity?.IsAuthenticated == true)
            {
                try { userId = http.User.UserId(); }
                catch (Exception ex) when (ex is InvalidOperationException or FormatException) { /* no sub */ }
            }

            return new AnalyticsEvent
            {
                Event = name,
                SessionId = Str(root, "sessionId") is { } sid && SessionIdPattern().IsMatch(sid) ? sid : null,
                UserId = userId,
                Path = CleanPath(Str(root, "path")),
                Props = CleanProps(root),
                Source = attribution?.Source,
                Medium = attribution?.Medium,
                Campaign = attribution?.Campaign,
                Referrer = attribution?.Referrer,
            };
        }
    }

    private static string? Str(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    /// <summary>Path only: query and hash removed, ids collapsed, ≤128 chars.</summary>
    public static string? CleanPath(string? raw)
    {
        if (string.IsNullOrEmpty(raw) || raw[0] != '/') return null;
        var end = raw.IndexOfAny(['?', '#']);
        var path = end >= 0 ? raw[..end] : raw;
        path = GuidPattern().Replace(path, ":id");
        foreach (var ch in path)
            if (char.IsControl(ch) || char.IsWhiteSpace(ch) || ch == '@') return null;
        return path.Length > 128 ? path[..128] : path;
    }

    /// <summary>Keeps at most <see cref="MaxProps"/> flat primitives with
    /// slug keys; strings are capped and anything address-like is dropped.</summary>
    public static string? CleanProps(JsonElement root)
    {
        if (!root.TryGetProperty("props", out var props) || props.ValueKind != JsonValueKind.Object)
            return null;
        var kept = new Dictionary<string, object>(StringComparer.Ordinal);
        foreach (var p in props.EnumerateObject())
        {
            if (kept.Count == MaxProps) break;
            if (!PropKeyPattern().IsMatch(p.Name)) continue;
            switch (p.Value.ValueKind)
            {
                case JsonValueKind.True: kept[p.Name] = true; break;
                case JsonValueKind.False: kept[p.Name] = false; break;
                case JsonValueKind.Number when p.Value.TryGetDouble(out var d) && double.IsFinite(d):
                    kept[p.Name] = d; break;
                case JsonValueKind.String:
                    var s = p.Value.GetString()!;
                    if (s.Length is > 0 and <= MaxPropString && !s.Contains('@')) kept[p.Name] = s;
                    break;
            }
        }
        return kept.Count == 0 ? null : JsonSerializer.Serialize(kept);
    }
}
