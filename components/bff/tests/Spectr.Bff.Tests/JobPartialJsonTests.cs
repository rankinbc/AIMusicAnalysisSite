using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.DTOs;
using Spectr.Bff.Endpoints;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Live analysis page — GET /api/jobs/{id} surfaces the worker's per-phase
// partial results (analysis_jobs.partial_json) as JobStatusDto.Partial.

public sealed class JobPartialJsonTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private async Task<(HttpClient C, Guid UserId)> SeedAuthedAsync()
    {
        var client = _factory.CreateClient();
        var email = $"jobpartial+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync(
            "/api/auth/register", new { email, password = "correct-horse-battery" });
        var auth = await reg.Content.ReadFromJsonAsync<AuthResponse>();
        Assert.NotNull(auth);
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", auth!.AccessToken);
        return (client, auth.User.Id);
    }

    private async Task<Guid> SeedJobAsync(Guid userId, string? partialJson)
    {
        var jobId = Guid.NewGuid();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.AnalysisJobs.Add(new AnalysisJob
        {
            Id = jobId,
            UserId = userId,
            Status = "processing",
            CurrentPhase = "Genre Detection",
            PhasePct = 0.2,
            PartialJson = partialJson,
        });
        await db.SaveChangesAsync();
        return jobId;
    }

    private async Task CleanupAsync(Guid userId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await TestAuth.AllowPurgeAsync(db);
        await db.CreditLedger.Where(e => e.UserId == userId).ExecuteDeleteAsync();
        await db.UsageEvents.Where(e => e.UserId == userId).ExecuteDeleteAsync();
        await db.AnalysisJobs.Where(j => j.UserId == userId).ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
    }

    [SkippableFact]
    public async Task GetJob_Surfaces_PartialJson()
    {
        await TestDb.RequireAsync(_factory);
        var (client, userId) = await SeedAuthedAsync();
        try
        {
            var jobId = await SeedJobAsync(userId,
                """{"phases":{"1":{"name":"Universal Mix Analysis","status":"ok","seconds":54.4,"data":{"lufs":-11.9}}}}""");

            var resp = await client.GetAsync($"/api/jobs/{jobId}");
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            var dto = await resp.Content.ReadFromJsonAsync<JobStatusDto>(Web);
            Assert.NotNull(dto);
            Assert.True(dto!.Partial.HasValue);
            var p1 = dto.Partial!.Value.GetProperty("phases").GetProperty("1");
            Assert.Equal(54.4, p1.GetProperty("seconds").GetDouble());
            Assert.Equal(-11.9, p1.GetProperty("data").GetProperty("lufs").GetDouble());
        }
        finally { await CleanupAsync(userId); }
    }

    [SkippableFact]
    public async Task GetJob_Without_PartialJson_Returns_Null_Partial()
    {
        await TestDb.RequireAsync(_factory);
        var (client, userId) = await SeedAuthedAsync();
        try
        {
            var jobId = await SeedJobAsync(userId, null);

            var resp = await client.GetAsync($"/api/jobs/{jobId}");
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            var partial = doc.RootElement.GetProperty("partial");
            Assert.Equal(JsonValueKind.Null, partial.ValueKind);
        }
        finally { await CleanupAsync(userId); }
    }

    [Fact]
    public void ParsePartial_Corrupt_Or_Empty_Is_Null()
    {
        Assert.Null(JobEndpoints.ParsePartial(null));
        Assert.Null(JobEndpoints.ParsePartial("  "));
        Assert.Null(JobEndpoints.ParsePartial("{not json"));
        Assert.Equal(JsonValueKind.Object, JobEndpoints.ParsePartial("{}")!.Value.ValueKind);
    }
}
