using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Spectr.Bff.Options;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 3.5 (NFR16) — the reaper must fail ABANDONED work but never a queue
// that is merely waiting out a worker restart: processing jobs reap on the
// short window from started_at; pending jobs only after the long grace.
public sealed class StaleJobReaperTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private StaleJobReaper NewReaper() => new(
        _factory.Services.GetRequiredService<IServiceScopeFactory>(),
        Microsoft.Extensions.Options.Options.Create(
            new WorkerOptions { StaleJobMinutes = 30, PendingGraceMinutes = 240 }),
        NullLogger<StaleJobReaper>.Instance);

    private async Task<Guid> SeedJobAsync(
        Guid userId, Guid versionId, string status,
        DateTimeOffset dispatchedAt, DateTimeOffset? startedAt)
    {
        var jobId = Guid.NewGuid();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.AnalysisJobs.Add(new AnalysisJob
        {
            Id = jobId,
            UserId = userId,
            VersionId = versionId,
            Status = status,
            DispatchedAt = dispatchedAt,
            StartedAt = startedAt,
        });
        await db.SaveChangesAsync();
        return jobId;
    }

    private async Task<string?> StatusOfAsync(Guid jobId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.AnalysisJobs.AsNoTracking()
            .Where(j => j.Id == jobId).Select(j => j.Status).FirstOrDefaultAsync();
    }

    private async Task CleanupAsync(params Guid[] jobIds)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.AnalysisJobs.Where(j => jobIds.Contains(j.Id)).ExecuteDeleteAsync();
    }

    [Fact]
    public async Task Pending_Jobs_Survive_The_Processing_Window_But_Not_The_Grace()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var (_, versionId) = await TestSeed.SongWithVersionAsync(_factory, userId);
        var now = DateTimeOffset.UtcNow;

        // Queued 2 h ago (worker down) — must SURVIVE (NFR16: queued, not failed).
        var queuedSurvivor = await SeedJobAsync(userId, versionId, "pending",
            dispatchedAt: now.AddHours(-2), startedAt: null);
        // Queued 5 h ago — beyond the 4 h grace: truly orphaned, resurface.
        var queuedOrphan = await SeedJobAsync(userId, versionId, "pending",
            dispatchedAt: now.AddHours(-5), startedAt: null);
        // Started 40 min ago and abandoned — the classic reap.
        var abandoned = await SeedJobAsync(userId, versionId, "processing",
            dispatchedAt: now.AddHours(-1), startedAt: now.AddMinutes(-40));
        // Started 5 min ago — live, untouched.
        var live = await SeedJobAsync(userId, versionId, "processing",
            dispatchedAt: now.AddMinutes(-6), startedAt: now.AddMinutes(-5));

        try
        {
            await NewReaper().ReapAsync(CancellationToken.None);

            Assert.Equal("pending", await StatusOfAsync(queuedSurvivor));   // NFR16
            Assert.Equal("failed", await StatusOfAsync(queuedOrphan));
            Assert.Equal("failed", await StatusOfAsync(abandoned));
            Assert.Equal("processing", await StatusOfAsync(live));

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var reaped = await db.AnalysisJobs.AsNoTracking().SingleAsync(j => j.Id == abandoned);
            Assert.Equal("worker_unavailable", reaped.ErrorCode); // never invalid_file
        }
        finally
        {
            await CleanupAsync(queuedSurvivor, queuedOrphan, abandoned, live);
        }
    }

    [Fact]
    public async Task Progress_Restores_Via_The_Poll_Path_For_A_Processing_Job()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        // Story 3.5 AC1 (FR8): the Results page restores progress by polling
        // GET /jobs/{id} — a mid-flight job must surface status + phase + pct.
        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var (_, versionId) = await TestSeed.SongWithVersionAsync(_factory, userId);

        var jobId = Guid.NewGuid();
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.AnalysisJobs.Add(new AnalysisJob
            {
                Id = jobId,
                UserId = userId,
                VersionId = versionId,
                Status = "processing",
                CurrentPhase = "stem_clash",
                PhasePct = 0.55,
                StartedAt = DateTimeOffset.UtcNow.AddMinutes(-2),
            });
            await db.SaveChangesAsync();
        }

        try
        {
            var body = await client.GetFromJsonAsync<System.Text.Json.JsonElement>($"/api/jobs/{jobId}");
            Assert.Equal("processing", body.GetProperty("status").GetString());
            Assert.Equal("stem_clash", body.GetProperty("currentPhase").GetString());
            Assert.Equal(0.55, body.GetProperty("phasePct").GetDouble(), precision: 2);
        }
        finally
        {
            await CleanupAsync(jobId);
        }
    }
}
