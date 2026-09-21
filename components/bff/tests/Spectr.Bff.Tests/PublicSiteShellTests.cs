using Microsoft.AspNetCore.Mvc.Testing;
using System.Net;
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
    [InlineData("/trust/no-training", "No AI training on your audio — SPECTR")]
    [InlineData("/trust/results-forever", "Your results stay yours — SPECTR")]
    [InlineData("/trust/privacy", "Privacy defaults — SPECTR")]
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
}
