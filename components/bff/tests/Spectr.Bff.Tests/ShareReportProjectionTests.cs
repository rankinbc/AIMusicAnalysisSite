using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 7.1 — the FR22/AC3 default-deny share projection + AC1 regenerate.
public sealed class ShareReportProjectionTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    // A final_json salted with everything that must NEVER reach a stranger.
    private static string PoisonedFinalJson() => JsonSerializer.Serialize(new
    {
        grade = "B",
        overall_score = 82.5,
        danceability_score = 74,
        secret_root_field = "MUST_NOT_LEAK_ROOT",
        phases = new object[]
        {
            new { phase = 1, name = "universal", data = new {
                bpm = 138.0, detected_key = "A#", lufs = -9.2, true_peak_db = -0.4,
                duration_seconds = 312.0,
                source_file = "MUST_NOT_LEAK_UPLOAD_KEY_audio/u1/j1/source.wav" } },
            new { phase = 2, name = "genre", data = new { genre = "trance", confidence = 0.91 } },
            new { phase = 4, name = "stems", data = new {
                stem_paths = "MUST_NOT_LEAK_STEM_PATHS", clashes = new object[] { } } },
            new { phase = 8, name = "als", data = new {
                track_names = new[] { "MUST_NOT_LEAK_ALS_TRACKS" },
                devices = new[] { "MUST_NOT_LEAK_PLUGINS" } } },
        },
    });

    [Fact]
    public void Projection_Is_DefaultDeny_Allowlist()
    {
        using var doc = JsonDocument.Parse(PoisonedFinalJson());
        var projected = ShareReportProjection.Build(doc.RootElement.Clone());
        var json = JsonSerializer.Serialize(projected);

        // Allowlisted values flow through…
        Assert.Contains("\"grade\":\"B\"", json);
        Assert.Contains("82.5", json);
        Assert.Contains("138", json);
        Assert.Contains("trance", json);

        // …everything else is DENIED — .als internals, stems, upload keys,
        // and any UNKNOWN field (default-deny is the property under test).
        Assert.DoesNotContain("MUST_NOT_LEAK", json);
        Assert.DoesNotContain("stem_paths", json);
        Assert.DoesNotContain("track_names", json);
        Assert.DoesNotContain("devices", json);
        Assert.DoesNotContain("source_file", json);
        Assert.DoesNotContain("secret_root_field", json);
    }

    [Fact]
    public void Projection_Handles_Missing_And_Malformed_Input()
    {
        var empty = JsonSerializer.Serialize(ShareReportProjection.Build(null));
        Assert.Equal("{}", empty);

        using var arr = JsonDocument.Parse("[1,2,3]");
        var fromArray = JsonSerializer.Serialize(ShareReportProjection.Build(arr.RootElement.Clone()));
        Assert.Equal("{}", fromArray);
    }

    // ── integration: public endpoint serves ONLY the projection; regenerate
    //    kills the old token (Postgres-gated) ─────────────────────────────────

    [Fact]
    public async Task PublicShare_Serves_Projection_And_Regenerate_Kills_Old_Token()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        // Seed an analysis with the poisoned final_json.
        var analysisId = Guid.NewGuid();
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Analyses.Add(new Analysis
            {
                Id = analysisId,
                JobId = Guid.NewGuid(),
                UserId = userId,
                SongName = "Poison Test",
                FinalJson = PoisonedFinalJson(),
            });
            await db.SaveChangesAsync();
        }

        // Create the share and fetch it anonymously.
        var create = await client.PostAsync($"/api/analyses/{analysisId}/share/", null);
        Assert.Equal(HttpStatusCode.OK, create.StatusCode);
        var share = await create.Content.ReadFromJsonAsync<JsonElement>();
        var shareToken = share.GetProperty("shareToken").GetString()!;

        var anon = _factory.CreateClient();
        var pub = await anon.GetAsync($"/api/share/{shareToken}/");
        Assert.Equal(HttpStatusCode.OK, pub.StatusCode);
        var body = await pub.Content.ReadAsStringAsync();
        Assert.Contains("Poison Test", body);
        Assert.DoesNotContain("MUST_NOT_LEAK", body); // AC3 across the wire

        // AC1 — regenerate: new token works, old token is dead.
        var regen = await client.PostAsync($"/api/analyses/{analysisId}/share/regenerate", null);
        Assert.Equal(HttpStatusCode.OK, regen.StatusCode);
        var regenBody = await regen.Content.ReadFromJsonAsync<JsonElement>();
        var newToken = regenBody.GetProperty("shareToken").GetString()!;
        Assert.NotEqual(shareToken, newToken);

        Assert.Equal(HttpStatusCode.NotFound, (await anon.GetAsync($"/api/share/{shareToken}/")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await anon.GetAsync($"/api/share/{newToken}/")).StatusCode);
    }
}
