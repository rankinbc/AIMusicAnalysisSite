using Microsoft.AspNetCore.Mvc.Testing;
using System.Net;
using System.Net.Http.Headers;
using System.Text.RegularExpressions;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 6.1 — crawler meta shells for the public funnel pages (/ and /pricing,
// root-level non-/api; the Caddy @site_bots split routes crawler UAs here).
// Static HTML, no DB — these tests run without Postgres.
public sealed class PublicSiteShellTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    [Theory]
    [InlineData("/", "SPECTR — AI mix analysis for producers")]
    [InlineData("/pricing", "Pricing — SPECTR")]
    [InlineData("/features", "Features — SPECTR")]
    [InlineData("/trust/no-training", "No AI training on your audio — SPECTR")]
    [InlineData("/trust/results-forever", "Your results stay yours — SPECTR")]
    [InlineData("/trust/privacy", "Privacy defaults — SPECTR")]
    [InlineData("/trust/how-its-built", "How SPECTR works — SPECTR")]
    public async Task Shell_Serves_Html_With_Meta_And_Canonical(string path, string expectedTitle)
    {
        var client = _factory.CreateClient();
        var resp = await client.GetAsync(path);

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        Assert.StartsWith("text/html", resp.Content.Headers.ContentType?.MediaType);

        var html = await resp.Content.ReadAsStringAsync();
        Assert.Contains($"<title>{expectedTitle}</title>", html);
        Assert.Contains("og:title", html);
        Assert.Contains("og:description", html);
        Assert.Contains("og:image", html);
        Assert.Contains("meta name=\"description\"", html);
        Assert.Contains("rel=\"canonical\"", html);
        // Unlike /r/{token} these ARE the public pages — no noindex.
        Assert.DoesNotContain("noindex", html);

        // Review findings: shells are cacheable AND must never carry the
        // anon-identity Set-Cookie (shared-cache cookie bleed).
        Assert.Contains("public", resp.Headers.CacheControl?.ToString());
        Assert.False(resp.Headers.Contains("Set-Cookie"));
    }

    [Fact]
    public async Task Shells_Are_Anonymous()
    {
        // No Authorization header at all — both must still 200.
        var client = _factory.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/pricing")).StatusCode);
    }

    [Fact]
    public async Task Pricing_Shell_Tells_The_Truth_When_Credits_Are_Off()
    {
        var client = _factory.WithWebHostBuilder(b => b.UseSetting("Credits:Enabled", "false")).CreateClient();
        var html = await (await client.GetAsync("/pricing")).Content.ReadAsStringAsync();
        Assert.Contains("<title>Pricing — SPECTR</title>", html);
        Assert.Contains("Free while we launch", html);
        Assert.DoesNotContain("per-release credits", html);
    }

    // Task P6 fix1 — every crawler shell, guarded. NoSocialSurfaceTests.cs
    // owns a DB-gated ([SkippableFact]) version of this same idea but its
    // hard-coded path list predates /trust/how-its-built (P6) and is
    // owner-locked (solo-fork guard, do not edit there). This copy needs no
    // DB, runs unconditionally, and enumerates every path this file already
    // exercises above — ADD A NEW SHELL TO BOTH THE [InlineData] LIST ABOVE
    // AND ShellPaths BELOW, or it silently goes unguarded.
    private static readonly string[] ShellPaths =
    [
        "/", "/pricing", "/analyze", "/features",
        "/trust/no-training", "/trust/results-forever", "/trust/privacy", "/trust/how-its-built",
    ];

    private static readonly Regex BannedWords = new(
        "invite|follower|public profile|revocable|opt-in share|share links are|publish your|live room|listening room",
        RegexOptions.IgnoreCase);

    [Fact]
    public async Task Every_Shell_Carries_No_Banned_Social_Words()
    {
        var client = _factory.CreateClient();

        foreach (var path in ShellPaths)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, path);
            request.Headers.UserAgent.ParseAdd("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)");
            var resp = await client.SendAsync(request);

            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            var html = await resp.Content.ReadAsStringAsync();
            var match = BannedWords.Match(html);
            Assert.False(match.Success, $"{path} carries banned word '{match.Value}':\n{html}");
        }
    }
}
