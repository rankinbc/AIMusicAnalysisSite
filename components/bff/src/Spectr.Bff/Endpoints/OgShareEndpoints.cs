using Microsoft.EntityFrameworkCore;
using Spectr.Bff.Services;
using Spectr.Data;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace Spectr.Bff.Endpoints;

// Story 7.2 — the crawler-facing OG share shell (FR22/AR28).
//
// Mapped at ROOT (/r/{token}), not under /api: in prod, nginx routes /r/*
// to this endpoint ONLY for crawler user-agents (Discord/Slack/Twitter/…)
// and serves the SPA to humans — see frontend nginx.conf. The shell carries
// OG/Twitter meta (grade, verdict text, track name, branded image),
// per-report noindex, and the inline ShareReportProjection JSON so a
// hydrating client never double-fetches.
public static class OgShareEndpoints
{
    public static IEndpointRouteBuilder MapOgShareEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/r/{token}", GetShell).AllowAnonymous().WithTags("share");
        return app;
    }

    private static async Task<IResult> GetShell(
        string token,
        HttpRequest request,
        AppDbContext db,
        CancellationToken ct)
    {
        var hit = await (
            from a in db.Analyses.AsNoTracking()
            join u in db.Users.AsNoTracking() on a.UserId equals u.Id
            where a.ShareToken == token
            select new { a, u.Handle, u.DisplayName }
        ).FirstOrDefaultAsync(ct);

        if (hit is null)
        {
            // 7.3's friendly gone page (revoked or never existed) — still noindex.
            return Results.Content(GonePage(), "text/html", Encoding.UTF8, 404);
        }

        var projection = ShareReportProjection.Build(ParseJson(hit.a.FinalJson));
        var grade = projection.TryGetProperty("grade", out var g) ? g.GetString() : null;

        // Verdict line for the description: hottest headline when the owner
        // shows verdicts, else a neutral score line.
        string? verdictLine = null;
        if (hit.a.ShareShowVerdicts)
        {
            verdictLine = await db.Verdicts.AsNoTracking()
                .Where(v => v.AnalysisId == hit.a.Id)
                .OrderByDescending(v => v.PriorityScore)
                .Select(v => v.Headline)
                .FirstOrDefaultAsync(ct);
        }
        if (string.IsNullOrWhiteSpace(verdictLine) &&
            projection.TryGetProperty("overall_score", out var score))
        {
            verdictLine = $"Mix score {Math.Round(score.GetDouble())}/100 on SPECTR";
        }
        verdictLine ??= "Analyzed on SPECTR";

        var song = string.IsNullOrWhiteSpace(hit.a.SongName) ? "Untitled" : hit.a.SongName!;
        var by = hit.DisplayName ?? (hit.Handle is null ? null : $"@{hit.Handle}");
        var title = grade is null ? $"{song} — SPECTR report" : $"{song} — grade {grade} on SPECTR";
        var origin = $"{request.Scheme}://{request.Host}";

        var e = HtmlEncoder.Default;
        var inlineJson = JsonSerializer.Serialize(projection);
        var html = $$"""
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{e.Encode(title)}}</title>
<meta name="robots" content="noindex, nofollow">
<meta property="og:type" content="website">
<meta property="og:site_name" content="SPECTR">
<meta property="og:title" content="{{e.Encode(title)}}">
<meta property="og:description" content="{{e.Encode(verdictLine)}}{{(by is null ? "" : e.Encode($" · by {by}"))}}">
<meta property="og:url" content="{{e.Encode($"{origin}/r/{token}")}}">
<meta property="og:image" content="{{e.Encode($"{origin}/og-share.png")}}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{{e.Encode(title)}}">
<meta name="twitter:description" content="{{e.Encode(verdictLine)}}">
<meta name="twitter:image" content="{{e.Encode($"{origin}/og-share.png")}}">
<style>
  body{margin:0;background:#070a12;color:#e2e8f4;font:16px/1.5 system-ui,sans-serif;
       display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px}
  .grade{font-size:72px;font-weight:800;color:#00e5b0;line-height:1;margin:8px 0}
  .muted{color:#64748b;font-size:13px}
  a{color:#00e5b0}
</style>
</head>
<body>
<main>
  <div class="muted">SPECTR · shared report</div>
  {{(grade is null ? "" : $"<div class=\"grade\">{e.Encode(grade)}</div>")}}
  <h1>{{e.Encode(song)}}</h1>
  <p>{{e.Encode(verdictLine)}}</p>
  <p><a href="{{e.Encode($"{origin}/r/{token}")}}">View the full report</a></p>
</main>
<script type="application/json" id="share-projection">{{inlineJson}}</script>
</body>
</html>
""";
        return Results.Content(html, "text/html", Encoding.UTF8);
    }

    private static string GonePage() => """
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Share link gone — SPECTR</title>
<meta name="robots" content="noindex, nofollow">
<style>body{margin:0;background:#070a12;color:#e2e8f4;font:16px/1.5 system-ui,sans-serif;
display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px}
.muted{color:#64748b;font-size:13px}</style>
</head>
<body><main>
<div class="muted">SPECTR</div>
<h1>This share link is gone</h1>
<p class="muted">The owner may have revoked it, or the link was mistyped.</p>
</main></body>
</html>
""";

    private static JsonElement? ParseJson(string? json)
    {
        if (string.IsNullOrEmpty(json)) return null;
        try
        {
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.Clone();
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
