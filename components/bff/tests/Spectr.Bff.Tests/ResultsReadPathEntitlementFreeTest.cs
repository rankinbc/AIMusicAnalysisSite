using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 2.4 / Task 11.3 / AC4 (AR15) — results-forever guarantee.
// GET /api/jobs/{id} and GET /api/jobs/{id}/results MUST NOT call
// EntitlementService.ForAsync. A counting subclass is registered in DI;
// after calling both read endpoints the spy count must be 0.
public sealed class ResultsReadPathEntitlementFreeTest(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;


    // Counting subclass — ForAsync increments the shared tracker on every call.
    private sealed class CountingEntitlementService(
        AppDbContext db,
        IMemoryCache cache,
        ILogger<EntitlementService> logger,
        CallTracker tracker)
        : EntitlementService(db, cache, logger)
    {
        public override async Task<EntitlementsDto> ForAsync(Guid userId, CancellationToken ct)
        {
            tracker.Increment();
            return await base.ForAsync(userId, ct);
        }
    }

    private sealed class CallTracker
    {
        private int _count;
        public int CallCount => System.Threading.Volatile.Read(ref _count);
        public void Increment() => System.Threading.Interlocked.Increment(ref _count);
        public void Reset() => System.Threading.Volatile.Write(ref _count, 0);
    }

    [SkippableFact]
    public async Task GetJobStatus_And_GetJobResults_NeverCallEntitlementService()
    {
        await TestDb.RequireAsync(_factory);

        var tracker = new CallTracker();

        var client = _factory.WithWebHostBuilder(b =>
        {
            b.ConfigureServices(s =>
            {
                s.RemoveAll<EntitlementService>();
                s.AddSingleton(tracker); // make tracker resolvable
                s.AddScoped<EntitlementService, CountingEntitlementService>(sp =>
                    new CountingEntitlementService(
                        sp.GetRequiredService<AppDbContext>(),
                        sp.GetRequiredService<IMemoryCache>(),
                        sp.GetRequiredService<ILogger<EntitlementService>>(),
                        tracker));
                s.RemoveAll<IJobQueue>();
                s.AddSingleton<IJobQueue>(new RecordingJobQueue());
            });
        }).CreateClient();

        // Register a free user.
        var email = $"results-ar15+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email, password = "correct-horse-battery" });
        reg.EnsureSuccessStatusCode();
        var auth = await reg.Content.ReadFromJsonAsync<AuthResponse>();
        Assert.NotNull(auth);
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", auth!.AccessToken);
        var userId = auth!.User.Id;

        // Seed: free user with 3 used analyses (exhausted) + completed job + analysis.
        Guid jobId;
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var period = DateTimeOffset.UtcNow.ToString("yyyy-MM");
            for (var i = 0; i < 3; i++)
            {
                db.UsageEvents.Add(new UsageEvent
                {
                    UserId = userId,
                    EventType = "analysis",
                    BillingPeriod = period,
                    Reference = Guid.NewGuid().ToString(),
                });
            }
            jobId = Guid.NewGuid();
            db.AnalysisJobs.Add(new AnalysisJob
            {
                Id = jobId,
                UserId = userId,
                Status = "complete",
                Tier = "free",
            });
            db.Analyses.Add(new Analysis
            {
                Id = Guid.NewGuid(),
                JobId = jobId,
                UserId = userId,
                FinalJson = "{}",
            });
            await db.SaveChangesAsync();
        }

        // Reset the tracker after any registration/warmup calls.
        tracker.Reset();

        // ── GET /api/jobs/{id} ──────────────────────────────────────────────
        var statusResp = await client.GetAsync($"/api/jobs/{jobId}");
        Assert.Equal(HttpStatusCode.OK, statusResp.StatusCode);

        // ── GET /api/jobs/{id}/results ──────────────────────────────────────
        var resultsResp = await client.GetAsync($"/api/jobs/{jobId}/results");
        Assert.Equal(HttpStatusCode.OK, resultsResp.StatusCode);

        // Neither endpoint may have called ForAsync (AR15 — results-forever).
        Assert.Equal(0, tracker.CallCount);
    }
}
