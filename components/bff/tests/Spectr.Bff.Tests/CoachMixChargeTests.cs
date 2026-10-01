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
using Xunit;

namespace Spectr.Bff.Tests;

public sealed class CoachMixChargeTests(WebApplicationFactory<Program> baseFactory)
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
            b.UseSetting("Credits:Prices:CoachMix", "5");
            b.ConfigureTestServices(s =>
            {
                s.RemoveAll(typeof(IJobQueue));
                s.AddSingleton(queue);
            });
        });

    private static async Task<(HttpClient C, Guid Uid, Guid JobId)> SeedAsync(
        WebApplicationFactory<Program> f, int grant, bool pro = false)
    {
        var client = f.CreateClient();
        var (uid, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var (_, versionId) = await TestSeed.SongWithVersionAsync(f, uid);
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var jobId = Guid.NewGuid();
        db.AnalysisJobs.Add(new AnalysisJob { Id = jobId, UserId = uid, Status = "complete", Tier = "credits" });
        db.Analyses.Add(new Analysis { Id = Guid.NewGuid(), JobId = jobId, UserId = uid, VersionId = versionId, FinalJson = "{}" });
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
        await db.SaveChangesAsync();
        await scope.ServiceProvider.GetRequiredService<CreditLedgerService>()
            .GrantSignupBonusAsync(uid, grant, CancellationToken.None);
        return (client, uid, jobId);
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
        await db.CreditLedger.Where(e => e.UserId == userId).ExecuteDeleteAsync();
        await db.UsageEvents.Where(e => e.UserId == userId).ExecuteDeleteAsync();
        await db.Subscriptions.Where(s => s.UserId == userId).ExecuteDeleteAsync();
        await db.Analyses.Where(a => a.UserId == userId).ExecuteDeleteAsync();
        await db.AnalysisJobs.Where(j => j.UserId == userId).ExecuteDeleteAsync();
        var songIds = await db.Songs.Where(s => s.UserId == userId).Select(s => s.Id).ToListAsync();
        await db.SongVersions.Where(v => songIds.Contains(v.SongId)).ExecuteDeleteAsync();
        await db.Songs.Where(s => s.UserId == userId).ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
    }

    [SkippableFact]
    public async Task Coach_Mix_Costs_5_For_Credits_User()
    {
        var f = Build(new NoopQueue());
        await TestDb.RequireAsync(f);
        var (c, uid, jobId) = await SeedAsync(f, grant: 20);
        try
        {
            Assert.Equal(HttpStatusCode.Accepted, (await c.PostAsync($"/api/reports/{jobId}/fix-rack", null)).StatusCode);
            Assert.Equal(15, await BalanceAsync(f, uid));
        }
        finally { await CleanupAsync(f, uid); }
    }

    [SkippableFact]
    public async Task Coach_Mix_Without_Credits_Returns_402()
    {
        var f = Build(new NoopQueue());
        await TestDb.RequireAsync(f);
        var (c, uid, jobId) = await SeedAsync(f, grant: 2);
        try
        {
            await TestContract.AssertEnvelopeAsync(
                await c.PostAsync($"/api/reports/{jobId}/fix-rack", null),
                HttpStatusCode.PaymentRequired, "insufficient_credits");
            Assert.Equal(2, await BalanceAsync(f, uid));
        }
        finally { await CleanupAsync(f, uid); }
    }

    [SkippableFact]
    public async Task Coach_Mix_Free_For_Pro()
    {
        var f = Build(new NoopQueue());
        await TestDb.RequireAsync(f);
        var (c, uid, jobId) = await SeedAsync(f, grant: 20, pro: true);
        try
        {
            Assert.Equal(HttpStatusCode.Accepted, (await c.PostAsync($"/api/reports/{jobId}/fix-rack", null)).StatusCode);
            Assert.Equal(20, await BalanceAsync(f, uid));
        }
        finally { await CleanupAsync(f, uid); }
    }

    [SkippableFact]
    public async Task Coach_Mix_Is_Refunded_When_Enqueue_Fails()
    {
        var f = Build(new ThrowingQueue());
        await TestDb.RequireAsync(f);
        var (c, uid, jobId) = await SeedAsync(f, grant: 20);
        try
        {
            try { await c.PostAsync($"/api/reports/{jobId}/fix-rack", null); } catch { /* test host rethrows */ }
            Assert.Equal(20, await BalanceAsync(f, uid));
        }
        finally { await CleanupAsync(f, uid); }
    }
}
