using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Per-phase re-run endpoint: POST /api/reports/{jobId}/phases/{phase}/rerun.
// Reuses RecordingJobQueue (from UploadDeferralTests) to assert dispatch without Redis.
// Gated on Postgres like the other integration tests.
public sealed class RerunPhaseTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private (HttpClient client, RecordingJobQueue queue) NewClient()
    {
        var queue = new RecordingJobQueue();
        var client = _factory.WithWebHostBuilder(b =>
        {
            b.ConfigureServices(s =>
            {
                s.RemoveAll<IJobQueue>();
                s.AddSingleton<IJobQueue>(queue);
            });
        }).CreateClient();
        return (client, queue);
    }

    [Fact]
    public async Task RerunPhase_Valid_Enqueues_And_Creates_RerunJob()
    {
        if (!await PostgresReachable()) { return; }

        var (client, queue) = NewClient();
        var userId = await Authenticate(client);
        var jobId = await SeedAnalysis(userId);

        var resp = await client.PostAsync($"/api/reports/{jobId}/phases/4/rerun", null);
        Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);

        var body = await resp.Content.ReadFromJsonAsync<RerunPhaseResponse>();
        Assert.NotNull(body);
        Assert.NotEqual(Guid.Empty, body!.JobId);

        Assert.Single(queue.Calls);
        Assert.Equal(DramatiqTasks.RerunPhase, queue.Calls.First());

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var rerunJob = await db.AnalysisJobs.AsNoTracking().FirstOrDefaultAsync(j => j.Id == body.JobId);
        Assert.NotNull(rerunJob);
        Assert.Equal("pending", rerunJob!.Status);
    }

    [Fact]
    public async Task RerunPhase_Phase1_Rejected()
    {
        if (!await PostgresReachable()) { return; }
        var (client, queue) = NewClient();
        await Authenticate(client);

        var resp = await client.PostAsync($"/api/reports/{Guid.NewGuid()}/phases/1/rerun", null);
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        Assert.Empty(queue.Calls);
    }

    [Fact]
    public async Task RerunPhase_OutOfRange_Rejected()
    {
        if (!await PostgresReachable()) { return; }
        var (client, queue) = NewClient();
        await Authenticate(client);

        var resp = await client.PostAsync($"/api/reports/{Guid.NewGuid()}/phases/99/rerun", null);
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        Assert.Empty(queue.Calls);
    }

    [Fact]
    public async Task RerunPhase_UnknownAnalysis_NotFound()
    {
        if (!await PostgresReachable()) { return; }
        var (client, queue) = NewClient();
        await Authenticate(client);

        var resp = await client.PostAsync($"/api/reports/{Guid.NewGuid()}/phases/5/rerun", null);
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        Assert.Empty(queue.Calls);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static async Task<Guid> Authenticate(HttpClient client)
    {
        var email = $"rerun+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email, password = "correct-horse-battery" });
        reg.EnsureSuccessStatusCode();
        var auth = await reg.Content.ReadFromJsonAsync<AuthResponse>();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", auth!.AccessToken);
        return auth.User.Id;
    }

    // Insert a completed analysis_job + analysis directly so the endpoint has a
    // row to own — avoids running the full upload+analysis pipeline.
    private async Task<Guid> SeedAnalysis(Guid userId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var jobId = Guid.NewGuid();
        db.AnalysisJobs.Add(new AnalysisJob { Id = jobId, UserId = userId, Status = "complete" });
        db.Analyses.Add(new Analysis
        {
            Id = Guid.NewGuid(),
            JobId = jobId,
            UserId = userId,
            FinalJson = "{}",
        });
        await db.SaveChangesAsync();
        return jobId;
    }

    private async Task<bool> PostgresReachable()
    {
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.Database.CanConnectAsync();
        }
        catch
        {
            return false;
        }
    }
}
