using System.Text;
using Spectr.Bff.Services;

namespace Spectr.Bff.Endpoints;

// Story 6.1 — crawler-facing meta shells for the public funnel pages.
//
// Mapped at ROOT (/ and /pricing), not under /api: the prod Caddy edge routes
// these paths to the BFF ONLY for crawler user-agents (the @site_bots matcher,
// same UA set as the 7.2 share split) — humans always get the SPA. Static
// HTML, no DB, no user input → nothing dynamic to encode. Follows the
// OgShareEndpoints conventions (7.2).
public static class PublicSiteEndpoints
{
    public static IEndpointRouteBuilder MapPublicSiteEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/", LandingShell).AllowAnonymous().WithTags("public-site");
        app.MapGet("/pricing", PricingShell).AllowAnonymous().WithTags("public-site");
        // Story 6.3 — the anon funnel entry.
        app.MapGet("/analyze", (HttpContext c) => Shell(c,
            path: "/analyze",
            title: "Analyze your track free — SPECTR",
            description: "Drop a track, get a graded 7-phase mix analysis in minutes. No account, no forms — WAV, FLAC or MP3 up to 250 MB.",
            heading: "Drop your track. Get the truth.",
            body: "A real 7-phase mix analysis — graded, measured, no account needed.")).AllowAnonymous().WithTags("public-site");
        // Story 6.2 — trust pages.
        // DRAFT: these shell strings are a SECOND COPY of the trust-page
        // commitments and must be updated together with the route files when
        // the founder copy review lands (launch checklist) — crawlers serve
        // THESE, not the SPA copy.
        app.MapGet("/trust/no-training", (HttpContext c) => Shell(c,
            path: "/trust/no-training",
            title: "No AI training on your audio — SPECTR",
            description: "SPECTR's versioned no-training pledge: your audio never trains a model, and raw audio is never sent to any LLM.",
            heading: "No AI training on your audio",
            body: "Your audio never trains a model. Raw audio is never sent to any LLM — only derived report text.")).AllowAnonymous().WithTags("public-site");
        app.MapGet("/trust/results-forever", (HttpContext c) => Shell(c,
            path: "/trust/results-forever",
            title: "Your results stay yours — SPECTR",
            description: "Every report you generate remains accessible after cancellation. Raw audio retention is separate and stated plainly.",
            heading: "Your results stay yours — forever",
            body: "Reports never expire, even after you cancel. Raw audio follows a stated retention schedule; the report always remains.")).AllowAnonymous().WithTags("public-site");
        app.MapGet("/trust/privacy", (HttpContext c) => Shell(c,
            path: "/trust/privacy",
            title: "Privacy defaults — SPECTR",
            description: "Private-by-default library, no public pages or share links, anonymous analysis data purged after 72 hours, full export and deletion.",
            heading: "Privacy defaults",
            body: "Private by default. Nothing you upload is visible to anyone else. Export or delete everything, any time.")).AllowAnonymous().WithTags("public-site");
        return app;
    }

    private static IResult LandingShell(HttpContext context) =>
        Shell(context,
            path: "/",
            title: "SPECTR — AI mix analysis for producers",
            description: "Upload a track, get a graded 7-phase mix report with concrete fixes — " +
                         "loudness, low end, stereo image, arrangement — plus an AI coach that hears what you hear.",
            heading: "Know exactly what's wrong with your mix",
            body: "A graded report across loudness, low end, stereo image and arrangement — with concrete fixes you can hear.");

    // Task P2 (public-surfaces-polish D6/D7) — the crawler shell tells the
    // same truth the SPA does: when credits are off, don't advertise plans
    // that can't be bought. `creditsEnabled == null` (unknown — a failed
    // flag read) falls through to today's plans copy rather than blocking
    // the crawler response on a retry.
    private static async Task<IResult> PricingShell(
        HttpContext context,
        EntitlementService entitlements,
        IConfiguration config,
        ILoggerFactory loggers,
        CancellationToken ct)
    {
        var creditsEnabled = await PublicCredits.ResolveAsync(
            config, entitlements.GetFlagsAsync, loggers.CreateLogger("PublicCredits"), ct);

        if (creditsEnabled == false)
        {
            return Shell(context,
                path: "/pricing",
                title: "Pricing — SPECTR",
                description: "SPECTR is free while we launch — paid plans are switched off. Reports stay yours forever.",
                heading: "Free while we launch.",
                body: "Unlimited analyses, the full coach and every specialist. Paid plans are switched off for now.");
        }

        return Shell(context,
            path: "/pricing",
            title: "Pricing — SPECTR",
            description: "Free, Pro, and per-release credits. Honest billing, no asterisks — " +
                         "reports stay yours forever, even after you cancel.",
            heading: "Honest billing. No asterisks.",
            body: "Free, Pro, and per-release credits. Reports stay yours forever — even after you cancel.");
    }

    private static IResult Shell(
        HttpContext context, string path, string title, string description, string heading, string body)
    {
        var request = context.Request;
        var origin = $"{request.Scheme}://{request.Host}";
        var url = $"{origin}{(path == "/" ? "/" : path)}";

        // Review findings: (1) shells are cacheable — copy changes only on
        // deploy; (2) the anon-identity middleware minted a Set-Cookie for
        // cookieless crawler hits, which must never ride a cacheable response
        // (shared-cache cookie bleed the moment an edge cache appears).
        context.Response.Headers.CacheControl = "public, max-age=3600";
        context.Response.Headers.Remove("Set-Cookie");
        // Static trusted strings only — no user input reaches this HTML.
        var html = $$"""
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{title}}</title>
<meta name="description" content="{{description}}">
<link rel="canonical" href="{{url}}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="SPECTR">
<meta property="og:title" content="{{title}}">
<meta property="og:description" content="{{description}}">
<meta property="og:url" content="{{url}}">
<meta property="og:image" content="{{origin}}/og-share.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{{title}}">
<meta name="twitter:description" content="{{description}}">
<meta name="twitter:image" content="{{origin}}/og-share.png">
<style>
  body{margin:0;background:#070a12;color:#e2e8f4;font:16px/1.5 system-ui,sans-serif;
       display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px}
  .muted{color:#64748b;font-size:13px}
  a{color:#00e5b0}
</style>
</head>
<body>
<main>
  <div class="muted">SPECTR · AI music analysis</div>
  <h1>{{heading}}</h1>
  <p>{{body}}</p>
  <p><a href="{{url}}">{{url}}</a></p>
</main>
</body>
</html>
""";
        return Results.Content(html, "text/html", Encoding.UTF8);
    }
}
