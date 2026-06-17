using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
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
using System.Text.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 2.6 (AC1, AC2, AC4) — tier-aware coach caps.
//   • Pro: pooled MONTHLY cap across analyses; chip scope "month" + ResetsAt.
//   • Free: per-analysis cap, limit now from the resolver (coach_free_followups).
//   • A coach_message usage_event is appended per accepted message (the pooled
//     count's source of truth).
// Gated on Postgres via PostgresReachable() (mirrors CoachConversationEndpointsTests).
public sealed class CoachProMonthlyCapTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private sealed class RecordingJobQueue : IJobQueue
    {
        public Task EnqueueAsync(string taskName, object[] args, CancellationToken ct = default)
            => Task.CompletedTask;
        public Task EnqueueAsync(string taskName, object[] args, string queueName, CancellationToken ct = default)
            => Task.CompletedTask;
    }

    private (WebApplicationFactory<Program> Factory, HttpClient Client) NewClient()
    {
        var f = _factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll(typeof(IJobQueue));
            s.AddSingleton<IJobQueue>(new RecordingJobQueue());
        }));
        return (f, f.CreateClient());
    }

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

    private static async Task<(Guid UserId, string Email)> AuthAsync(HttpClient client, string prefix)
    {
        var email = $"{prefix}+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email, password = "correct-horse-battery" });
        reg.EnsureSuccessStatusCode();
        var auth = await reg.Content.ReadFromJsonAsync<AuthResponse>();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", auth!.AccessToken);
        return (auth.User.Id, email);
    }

    private async Task SeedProAsync(Guid userId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Subscriptions.Add(new Subscription
        {
            UserId = userId,
            StripeCustomerId = $"cus_pro_{Guid.NewGuid():N}",
            StripeSubscriptionId = $"sub_pro_{Guid.NewGuid():N}",
            Status = "active",
            PriceId = "price_test",
            CurrentPeriodEnd = DateTimeOffset.UtcNow.AddDays(30),
        });
        await db.SaveChangesAsync();
    }

    // Create an analysis (+ its job) for the user, returns the analysis id.
    private async Task<Guid> SeedAnalysisAsync(Guid userId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var job = new AnalysisJob
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Status = "complete",
            DispatchedAt = DateTimeOffset.UtcNow,
            CompletedAt = DateTimeOffset.UtcNow,
        };
        db.AnalysisJobs.Add(job);
        var analysis = new Analysis
        {
            Id = Guid.NewGuid(),
            JobId = job.Id,
            UserId = userId,
            FinalJson = "{}",
            PhaseDurations = "{}",
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Analyses.Add(analysis);
        await db.SaveChangesAsync();
        return analysis.Id;
    }

    private async Task SeedCoachUsageAsync(Guid userId, int count)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var period = DateTimeOffset.UtcNow.ToString("yyyy-MM");
        for (var i = 0; i < count; i++)
        {
            db.UsageEvents.Add(new UsageEvent
            {
                UserId = userId,
                EventType = "coach_message",
                BillingPeriod = period,
                Reference = Guid.NewGuid().ToString(),
            });
        }
        await db.SaveChangesAsync();
    }

    // ── AC1: Pro chip is pooled-monthly (scope "month", ResetsAt set) ─────────
    [Fact]
    public async Task ProUser_Conversation_Reports_MonthlyScope_With_ResetsAt()
    {
        if (!await PostgresReachable()) return;
        var (f, client) = NewClient();
        var (userId, _) = await AuthAsync(client, "coachpro-scope");
        await SeedProAsync(userId);
        var analysisId = await SeedAnalysisAsync(userId);

        var resp = await client.GetAsync($"/api/coach/{analysisId}/conversation");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<CoachConversationDto>();
        Assert.NotNull(body);
        Assert.Equal("month", body!.Caps.Scope);
        Assert.Equal(0, body.Caps.Used);
        Assert.True(body.Caps.Limit > 0);
        Assert.NotNull(body.Caps.ResetsAt);
        Assert.False(body.Caps.CapReached);
    }

    // ── AC1: the pool is shared ACROSS analyses (the whole point of pooling) ──
    [Fact]
    public async Task ProUser_Pool_Is_Shared_Across_Analyses()
    {
        if (!await PostgresReachable()) return;
        var (f, client) = NewClient();
        var (userId, _) = await AuthAsync(client, "coachpro-pool");
        await SeedProAsync(userId);
        var analysisA = await SeedAnalysisAsync(userId);
        var analysisB = await SeedAnalysisAsync(userId);

        // One message on analysis A, one on analysis B.
        var a = await client.PostAsJsonAsync($"/api/coach/{analysisA}/messages",
            new CreateCoachMessageRequest("Q on A"));
        Assert.Equal(HttpStatusCode.OK, a.StatusCode);
        var aBody = await a.Content.ReadFromJsonAsync<CreateCoachMessageResponse>();
        Assert.Equal(1, aBody!.Caps.Used);                  // pooled: 1 so far

        var b = await client.PostAsJsonAsync($"/api/coach/{analysisB}/messages",
            new CreateCoachMessageRequest("Q on B"));
        Assert.Equal(HttpStatusCode.OK, b.StatusCode);
        var bBody = await b.Content.ReadFromJsonAsync<CreateCoachMessageResponse>();
        Assert.Equal(2, bBody!.Caps.Used);                  // pooled across A+B
        Assert.Equal("month", bBody.Caps.Scope);

        // GET on analysis A now also reflects the pooled total (2), proving the
        // chip is monthly-pooled rather than per-analysis.
        var getA = await client.GetAsync($"/api/coach/{analysisA}/conversation");
        var getABody = await getA.Content.ReadFromJsonAsync<CoachConversationDto>();
        Assert.Equal(2, getABody!.Caps.Used);

        // Exactly two coach_message usage_events were appended (the meter).
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var period = DateTimeOffset.UtcNow.ToString("yyyy-MM");
        var meter = await db.UsageEvents.CountAsync(e =>
            e.UserId == userId && e.EventType == "coach_message" && e.BillingPeriod == period);
        Assert.Equal(2, meter);
    }

    // ── AC1 + AC4: at the pooled cap, POST is refused (COUNT guard) ──────────
    [Fact]
    public async Task ProUser_AtMonthlyCap_Refuses_With_MonthScope()
    {
        if (!await PostgresReachable()) return;
        var (f, client) = NewClient();
        var (userId, _) = await AuthAsync(client, "coachpro-cap");
        await SeedProAsync(userId);
        var analysisId = await SeedAnalysisAsync(userId);

        // Discover the live limit from the resolver, then saturate the pool.
        var seed = await client.GetAsync($"/api/coach/{analysisId}/conversation");
        var limit = (await seed.Content.ReadFromJsonAsync<CoachConversationDto>())!.Caps.Limit;
        await SeedCoachUsageAsync(userId, limit);

        // Chip now shows cap reached.
        var get = await client.GetAsync($"/api/coach/{analysisId}/conversation");
        var getBody = await get.Content.ReadFromJsonAsync<CoachConversationDto>();
        Assert.Equal(limit, getBody!.Caps.Used);
        Assert.True(getBody.Caps.CapReached);

        // POST refused with the monthly grammar + zero side effects.
        var refused = await client.PostAsJsonAsync($"/api/coach/{analysisId}/messages",
            new CreateCoachMessageRequest("one too many"));
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        using var doc = JsonDocument.Parse(await refused.Content.ReadAsStringAsync());
        var err = doc.RootElement.GetProperty("error");
        Assert.Equal("coach_cap_reached", err.GetProperty("code").GetString());
        var details = err.GetProperty("details");
        Assert.Equal(limit, details.GetProperty("limit").GetInt32());
        Assert.Equal("month", details.GetProperty("scope").GetString());

        // No conversation/message rows created by the refused POST.
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(0, await db.Conversations.CountAsync(c => c.UserId == userId));
    }

    // ── AC2: free-tier cap derives from the resolver and is per-analysis ─────
    [Fact]
    public async Task FreeUser_Conversation_Reports_AnalysisScope_From_Resolver()
    {
        if (!await PostgresReachable()) return;
        var (f, client) = NewClient();
        var (userId, _) = await AuthAsync(client, "coachfree-scope");
        var analysisId = await SeedAnalysisAsync(userId);

        var resp = await client.GetAsync($"/api/coach/{analysisId}/conversation");
        var body = await resp.Content.ReadFromJsonAsync<CoachConversationDto>();
        Assert.NotNull(body);
        Assert.Equal("analysis", body!.Caps.Scope);
        Assert.Equal(3, body.Caps.Limit);    // coach_free_followups flag (seeded 3)
        Assert.Null(body.Caps.ResetsAt);
    }
}
