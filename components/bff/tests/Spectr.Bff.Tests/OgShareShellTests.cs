using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 7.2 — the crawler OG shell at /r/{token} (root-level, non-/api).
public sealed class OgShareShellTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    [SkippableFact]
    public async Task Shell_Carries_Og_Meta_Noindex_And_Projection_Only()
    {
        await TestDb.RequireAsync(_factory);

        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var analysisId = Guid.NewGuid();
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Analyses.Add(new Analysis
            {
                Id = analysisId,
                JobId = Guid.NewGuid(),
                UserId = userId,
                SongName = "Neon <Skyline>", // exercises HTML escaping
                FinalJson = JsonSerializer.Serialize(new
                {
                    grade = "A",
                    overall_score = 91.0,
                    phases = new object[]
                    {
                        new { phase = 8, data = new { track_names = new[] { "MUST_NOT_LEAK" } } },
                    },
                }),
            });
            await db.SaveChangesAsync();
        }

        var create = await client.PostAsync($"/api/analyses/{analysisId}/share/", null);
        var share = await create.Content.ReadFromJsonAsync<JsonElement>();
        var shareToken = share.GetProperty("shareToken").GetString()!;

        var anon = _factory.CreateClient();
        var resp = await anon.GetAsync($"/r/{shareToken}");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        Assert.StartsWith("text/html", resp.Content.Headers.ContentType?.MediaType);
        var html = await resp.Content.ReadAsStringAsync();

        // AC1 — OG/Twitter meta with grade + track name + branded image.
        Assert.Contains("og:title", html);
        Assert.Contains("grade A on SPECTR", html);
        Assert.Contains("Neon &lt;Skyline&gt;", html); // escaped, not raw
        Assert.Contains("og:image", html);
        Assert.Contains("/og-share.png", html);
        Assert.Contains("twitter:card", html);

        // AC1 — inline projection JSON present; default-deny holds in the shell.
        Assert.Contains("share-projection", html);
        Assert.DoesNotContain("MUST_NOT_LEAK", html);

        // AC2 — per-report noindex.
        Assert.Contains("noindex", html);

        // AC3 — grade sits in the body (above-the-fold content exists).
        Assert.Contains("class=\"grade\"", html);
    }

    [SkippableFact]
    public async Task Unknown_Token_Serves_Friendly_Gone_Shell_404()
    {
        await TestDb.RequireAsync(_factory);

        var anon = _factory.CreateClient();
        var resp = await anon.GetAsync("/r/definitely-not-a-token");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        var html = await resp.Content.ReadAsStringAsync();
        Assert.Contains("This share link is gone", html);
        Assert.Contains("noindex", html);
    }
}
