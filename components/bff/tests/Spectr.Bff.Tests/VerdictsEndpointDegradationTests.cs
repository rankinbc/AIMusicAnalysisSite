using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.DTOs;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 1.4 integration test for the degradation surface: seed an Analysis
// row with a stamped degradation_notice + a rule-engine verdict, hit
// GET /api/reports/{jobId}/verdicts/, and assert the response carries the
// notice through the EF projection + JSON parse + DTO serialization round
// trip. Skips silently when Postgres isn't reachable, mirroring the
// AuthEndpointsTests gate.
public sealed class VerdictsEndpointDegradationTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private HttpClient NewClient() => _factory.CreateClient();

    private async Task<bool> PostgresReachable()
    {
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.Database.CanConnectAsync();
        }
        catch { return false; }
    }

    [Fact]
    public async Task Degraded_Analysis_Returns_Notice_And_Rule_Engine_Verdict()
    {
        if (!await PostgresReachable()) { return; }

        var client = NewClient();
        var email = $"degr+{Guid.NewGuid():N}@spectr.test";
        var password = "correct-horse-battery";

        // Register → access token.
        var reg = await client.PostAsJsonAsync("/api/auth/register", new { email, password });
        Assert.Equal(HttpStatusCode.OK, reg.StatusCode);
        var auth = await reg.Content.ReadFromJsonAsync<AuthResponse>();
        Assert.NotNull(auth);
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", auth!.AccessToken);

        // Seed: AnalysisJob → Analysis (with degradation_notice) → 1 rule_engine Verdict.
        Guid jobId;
        Guid analysisId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);

            var job = new AnalysisJob
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                Status = "complete",
                DispatchedAt = DateTimeOffset.UtcNow,
                CompletedAt = DateTimeOffset.UtcNow,
            };
            db.AnalysisJobs.Add(job);

            var analysis = new Analysis
            {
                Id = Guid.NewGuid(),
                JobId = job.Id,
                UserId = user.Id,
                FinalJson = "{}",
                PhaseDurations = "{}",
                DegradationNotice = """
                    {"reason":"tier_budget","detail":"tier=free spent=$5.00 ceiling=$5.00","occurred_at":"2026-06-15T12:00:00+00:00"}
                    """,
                CreatedAt = DateTimeOffset.UtcNow,
            };
            db.Analyses.Add(analysis);

            db.Verdicts.Add(new Verdict
            {
                Id = $"vrd_{Guid.NewGuid():N}".Substring(0, 30),
                AnalysisId = analysis.Id,
                Specialist = "rule_engine",
                PromptVersion = "rule_engine@1.0.0",
                Model = "rules",
                Severity = "critical",
                Category = "clipping",
                Confidence = 1.0,
                PriorityScore = 100,
                Impact = "med",
                Headline = "Hard clipping detected (1234 samples)",
                Summary = "Distortion is audible and unfixable downstream.",
                Body = "Distortion is audible and unfixable downstream.",
                Evidence = "[]",
                Sources = "[\"rule_engine\"]",
                CreatedAt = DateTimeOffset.UtcNow,
            });

            await db.SaveChangesAsync();
            jobId = job.Id;
            analysisId = analysis.Id;
        }

        var resp = await client.GetAsync($"/api/reports/{jobId}/verdicts/");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadAsStringAsync();

        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;

        // Wire-format contract: camelCase (JsonSerializerDefaults.Web).
        Assert.True(root.TryGetProperty("degradation", out var degradation),
            $"response missing 'degradation' field. Body: {body}");
        Assert.NotEqual(JsonValueKind.Null, degradation.ValueKind);
        Assert.Equal("tier_budget", degradation.GetProperty("reason").GetString());
        Assert.Equal(
            "tier=free spent=$5.00 ceiling=$5.00",
            degradation.GetProperty("detail").GetString());
        Assert.True(degradation.TryGetProperty("occurredAt", out _));

        // Rule-engine verdict surfaces through the same VerdictDto path as
        // specialists — confirms the "rule engine = normal verdict" guardrail.
        var verdicts = root.GetProperty("verdicts");
        Assert.True(verdicts.GetArrayLength() >= 1);
        Assert.Contains(verdicts.EnumerateArray(),
            v => v.GetProperty("specialist").GetString() == "rule_engine");

        // Cleanup so reruns don't accumulate.
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.AnalysisJobs.Where(j => j.Id == jobId).ExecuteDeleteAsync();
            await db.Users.Where(u => u.Email == email).ExecuteDeleteAsync();
        }
    }

    [Fact]
    public async Task Healthy_Analysis_Returns_Null_Degradation()
    {
        if (!await PostgresReachable()) { return; }

        var client = NewClient();
        var email = $"healthy+{Guid.NewGuid():N}@spectr.test";
        var password = "correct-horse-battery";

        var reg = await client.PostAsJsonAsync("/api/auth/register", new { email, password });
        Assert.Equal(HttpStatusCode.OK, reg.StatusCode);
        var auth = await reg.Content.ReadFromJsonAsync<AuthResponse>();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", auth!.AccessToken);

        Guid jobId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);

            var job = new AnalysisJob
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                Status = "complete",
                DispatchedAt = DateTimeOffset.UtcNow,
                CompletedAt = DateTimeOffset.UtcNow,
            };
            db.AnalysisJobs.Add(job);
            db.Analyses.Add(new Analysis
            {
                Id = Guid.NewGuid(),
                JobId = job.Id,
                UserId = user.Id,
                FinalJson = "{}",
                PhaseDurations = "{}",
                DegradationNotice = null,
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
            jobId = job.Id;
        }

        var resp = await client.GetAsync($"/api/reports/{jobId}/verdicts/");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.Equal(
            JsonValueKind.Null,
            doc.RootElement.GetProperty("degradation").ValueKind);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.AnalysisJobs.Where(j => j.Id == jobId).ExecuteDeleteAsync();
            await db.Users.Where(u => u.Email == email).ExecuteDeleteAsync();
        }
    }
}
