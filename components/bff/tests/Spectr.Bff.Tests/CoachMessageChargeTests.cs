using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Xunit;

namespace Spectr.Bff.Tests;

public sealed class CoachMessageChargeTests(WebApplicationFactory<Program> baseFactory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private sealed class NoopQueue : IJobQueue
    {
        public Task EnqueueAsync(string t, object[] a, CancellationToken ct = default) => Task.CompletedTask;
        public Task EnqueueAsync(string t, object[] a, string q, CancellationToken ct = default) => Task.CompletedTask;
        public Task EnqueueDelayedAsync(string t, object[] a, string q, TimeSpan d, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class ThrowingQueue : IJobQueue
    {
        public Task EnqueueAsync(string t, object[] a, CancellationToken ct = default) => throw new InvalidOperationException("redis down (test double)");
        public Task EnqueueAsync(string t, object[] a, string q, CancellationToken ct = default) => throw new InvalidOperationException("redis down (test double)");
        public Task EnqueueDelayedAsync(string t, object[] a, string q, TimeSpan d, CancellationToken ct = default) => throw new InvalidOperationException("redis down (test double)");
    }

    private WebApplicationFactory<Program> Build(IJobQueue queue) =>
        baseFactory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Credits:Prices:CoachMessage", "5");
            b.ConfigureTestServices(s =>
            {
                s.RemoveAll(typeof(IJobQueue));
                s.AddSingleton(queue);
            });
        });

    private async Task<(HttpClient C, Guid Uid, Guid AnalysisId)> SeedAsync(
        WebApplicationFactory<Program> f, int grant, bool pro = false, int coachUsedThisMonth = 0)
    {
        var client = f.CreateClient();
        var (uid, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var jobId = Guid.NewGuid();
        var analysisId = Guid.NewGuid();
        db.AnalysisJobs.Add(new AnalysisJob { Id = jobId, UserId = uid, Status = "complete", Tier = "credits" });
        db.Analyses.Add(new Analysis
        {
            Id = analysisId, JobId = jobId, UserId = uid, FinalJson = "{}",
            RoutingPlan = "{\"specialists_to_run\":[],\"skip\":[],\"rationale\":\"r\",\"estimated_total_tokens\":1}",
        });
        if (pro)
        {
            db.Subscriptions.Add(new Subscription
            {
                UserId = uid,
                StripeCustomerId = $"cus_pro_{Guid.NewGuid():N}",
                StripeSubscriptionId = $"sub_pro_{Guid.NewGuid():N}",
                Status = "active",
                PriceId = "price_test",
                CurrentPeriodEnd = DateTimeOffset.UtcNow.AddDays(30),
            });
        }
        for (var i = 0; i < coachUsedThisMonth; i++)
        {
            db.UsageEvents.Add(new UsageEvent
            {
                UserId = uid,
                EventType = "coach_message",
                BillingPeriod = DateTimeOffset.UtcNow.ToString("yyyy-MM"),
                Reference = Guid.NewGuid().ToString(),
            });
        }
        await db.SaveChangesAsync();
        await scope.ServiceProvider.GetRequiredService<CreditLedgerService>()
            .GrantSignupBonusAsync(uid, grant, CancellationToken.None);
        return (client, uid, analysisId);
    }

    private static async Task<int> BalanceAsync(WebApplicationFactory<Program> f, Guid uid)
    {
        using var scope = f.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<CreditLedgerService>().GetBalanceAsync(uid, CancellationToken.None);
    }

    private static async Task CleanupAsync(WebApplicationFactory<Program> f, Guid userId)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await TestAuth.AllowPurgeAsync(db);
        var convIds = await db.Conversations.Where(c => c.UserId == userId).Select(c => c.Id).ToListAsync();
        await db.CoachMessages.Where(m => convIds.Contains(m.ConversationId)).ExecuteDeleteAsync();
        await db.Conversations.Where(c => c.UserId == userId).ExecuteDeleteAsync();
        await db.CreditLedger.Where(e => e.UserId == userId).ExecuteDeleteAsync();
        await db.UsageEvents.Where(e => e.UserId == userId).ExecuteDeleteAsync();
        await db.Subscriptions.Where(s => s.UserId == userId).ExecuteDeleteAsync();
        await db.Analyses.Where(a => a.UserId == userId).ExecuteDeleteAsync();
        await db.AnalysisJobs.Where(j => j.UserId == userId).ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
    }

    [SkippableFact]
    public async Task Credits_User_Pays_5_Per_Message()
    {
        var f = Build(new NoopQueue());
        await TestDb.RequireAsync(f);
        var (c, uid, analysisId) = await SeedAsync(f, grant: 100);
        try
        {
            var resp = await c.PostAsJsonAsync($"/api/coach/{analysisId}/messages", new { content = "Why is my kick weak?" });
            Assert.True(resp.IsSuccessStatusCode, await resp.Content.ReadAsStringAsync());
            Assert.Equal(95, await BalanceAsync(f, uid));
        }
        finally { await CleanupAsync(f, uid); }
    }

    [SkippableFact]
    public async Task Credits_User_With_Too_Few_Credits_Gets_402_And_No_Message_Row()
    {
        var f = Build(new NoopQueue());
        await TestDb.RequireAsync(f);
        var (c, uid, analysisId) = await SeedAsync(f, grant: 3);
        try
        {
            var resp = await c.PostAsJsonAsync($"/api/coach/{analysisId}/messages", new { content = "hi" });
            await TestContract.AssertEnvelopeAsync(resp, HttpStatusCode.PaymentRequired, "insufficient_credits");
            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.False(await db.Conversations.AnyAsync(cv => cv.AnalysisId == analysisId));
        }
        finally { await CleanupAsync(f, uid); }
    }

    [SkippableFact]
    public async Task Pro_Over_Monthly_Cap_Is_Charged_Instead_Of_Refused()
    {
        var f = Build(new NoopQueue());
        await TestDb.RequireAsync(f);
        var (c, uid, analysisId) = await SeedAsync(f, grant: 50, pro: true, coachUsedThisMonth: 300);
        try
        {
            var resp = await c.PostAsJsonAsync($"/api/coach/{analysisId}/messages", new { content = "one more" });
            Assert.True(resp.IsSuccessStatusCode, await resp.Content.ReadAsStringAsync());
            Assert.Equal(45, await BalanceAsync(f, uid));
        }
        finally { await CleanupAsync(f, uid); }
    }

    [SkippableFact]
    public async Task Pro_Within_Monthly_Cap_Is_Free()
    {
        var f = Build(new NoopQueue());
        await TestDb.RequireAsync(f);
        var (c, uid, analysisId) = await SeedAsync(f, grant: 50, pro: true, coachUsedThisMonth: 3);
        try
        {
            var resp = await c.PostAsJsonAsync($"/api/coach/{analysisId}/messages", new { content = "free one" });
            Assert.True(resp.IsSuccessStatusCode, await resp.Content.ReadAsStringAsync());
            Assert.Equal(50, await BalanceAsync(f, uid));
        }
        finally { await CleanupAsync(f, uid); }
    }

    [SkippableFact]
    public async Task Enqueue_Failure_Refunds_The_Charge()
    {
        var f = Build(new ThrowingQueue());
        await TestDb.RequireAsync(f);
        var (c, uid, analysisId) = await SeedAsync(f, grant: 100);
        try
        {
            var resp = await c.PostAsJsonAsync($"/api/coach/{analysisId}/messages", new { content = "hello" });
            Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
            Assert.Equal(100, await BalanceAsync(f, uid));
        }
        finally { await CleanupAsync(f, uid); }
    }
}
