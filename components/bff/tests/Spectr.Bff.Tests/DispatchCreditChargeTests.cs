// components/bff/tests/Spectr.Bff.Tests/DispatchCreditChargeTests.cs
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Net;
using System.Net.Http.Headers;
using Xunit;

namespace Spectr.Bff.Tests;

public sealed class DispatchCreditChargeTests(WebApplicationFactory<Program> baseFactory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private WebApplicationFactory<Program> Factory(bool creditsOn = true) => baseFactory.WithWebHostBuilder(b =>
        b.UseSetting("Credits:Prices:Analysis", "100").UseSetting("Credits:ProAnalysesMonthly", "15")
         .UseSetting("Credits:Enabled", creditsOn ? "true" : "false")
         .UseSetting("RateLimits:Enabled", "false"));

    private static async Task<(HttpClient C, Guid Uid, Guid VersionId)> SeedAsync(
        WebApplicationFactory<Program> f, int grant, bool purchase = false, bool verified = true, bool pro = false, int proUsed = 0)
    {
        var client = f.CreateClient();
        var (uid, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var svc = scope.ServiceProvider.GetRequiredService<CreditLedgerService>();
        // Dev auto-verify makes registered users verified already; the unverified
        // cases null it out explicitly (the access token stays valid).
        await db.Users.Where(u => u.Id == uid).ExecuteUpdateAsync(s => s.SetProperty(
            u => u.EmailVerifiedAt, verified ? DateTimeOffset.UtcNow : (DateTimeOffset?)null));
        if (pro)
            db.Subscriptions.Add(new Subscription { UserId = uid, Status = "active", StripeCustomerId = $"cus_{uid:N}", StripeSubscriptionId = $"sub_{uid:N}", PriceId = "price_test" });
        if (proUsed > 0)
        {
            for (var i = 0; i < proUsed; i++)
                db.UsageEvents.Add(new UsageEvent { UserId = uid, EventType = "analysis", BillingPeriod = DateTimeOffset.UtcNow.ToString("yyyy-MM"), Reference = Guid.NewGuid().ToString() });
        }
        await db.SaveChangesAsync();
        if (grant > 0) await svc.GrantSignupBonusAsync(uid, grant, CancellationToken.None);
        if (purchase) await svc.PurchaseAsync(uid, 500, $"pi_{uid:N}", $"credits_purchase:t_{uid:N}", CancellationToken.None);
        scope.ServiceProvider.GetRequiredService<EntitlementService>().InvalidateAsync(uid);
        var (_, versionId) = await TestSeed.SongWithVersionAsync(f, uid);
        return (client, uid, versionId);
    }

    private static async Task<int> BalanceAsync(WebApplicationFactory<Program> f, Guid uid)
    {
        using var scope = f.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<CreditLedgerService>().GetBalanceAsync(uid, CancellationToken.None);
    }

    [SkippableFact]
    public async Task Analysis_Charges_The_Analysis_Price()
    {
        var f = Factory();
        await TestDb.RequireAsync(f);
        var (c, uid, vid) = await SeedAsync(f, grant: 500);
        var resp = await c.PostAsync($"/api/versions/{vid}/analyze", null);
        Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);
        Assert.Equal(400, await BalanceAsync(f, uid));
    }

    [SkippableFact]
    public async Task Balance_Below_Price_Returns_402_Insufficient_Credits()
    {
        var f = Factory();
        await TestDb.RequireAsync(f);
        var (c, uid, vid) = await SeedAsync(f, grant: 40);
        var resp = await c.PostAsync($"/api/versions/{vid}/analyze", null);
        await TestContract.AssertEnvelopeAsync(resp, HttpStatusCode.PaymentRequired, "insufficient_credits");
        Assert.Equal(40, await BalanceAsync(f, uid));
    }

    [SkippableFact]
    public async Task Grant_Only_Unverified_User_Hits_Verify_Gate_And_Is_Not_Charged()
    {
        var f = Factory();
        await TestDb.RequireAsync(f);
        // The registration-time demo job already counts as the user's "one
        // analysis", so the very first real dispatch of an unverified
        // grant-only account is gated (grant != paying).
        var (c, uid, vid) = await SeedAsync(f, grant: 500, verified: false);
        var resp = await c.PostAsync($"/api/versions/{vid}/analyze", null);
        await TestContract.AssertEnvelopeAsync(resp, HttpStatusCode.Forbidden, "email_verification_required");
        Assert.Equal(500, await BalanceAsync(f, uid));
    }

    [SkippableFact]
    public async Task Purchaser_Skips_Verify_Gate()
    {
        var f = Factory();
        await TestDb.RequireAsync(f);
        var (c, _, vid) = await SeedAsync(f, grant: 0, purchase: true, verified: false);
        Assert.Equal(HttpStatusCode.Accepted, (await c.PostAsync($"/api/versions/{vid}/analyze", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, (await c.PostAsync($"/api/versions/{vid}/analyze", null)).StatusCode);
    }

    [SkippableFact]
    public async Task Pro_Within_Allowance_Charges_No_Credits()
    {
        var f = Factory();
        await TestDb.RequireAsync(f);
        var (c, uid, vid) = await SeedAsync(f, grant: 100, pro: true, proUsed: 3);
        Assert.Equal(HttpStatusCode.Accepted, (await c.PostAsync($"/api/versions/{vid}/analyze", null)).StatusCode);
        Assert.Equal(100, await BalanceAsync(f, uid));
    }

    [SkippableFact]
    public async Task Pro_Past_Allowance_Overflows_To_Credits()
    {
        var f = Factory();
        await TestDb.RequireAsync(f);
        var (c, uid, vid) = await SeedAsync(f, grant: 100, pro: true, proUsed: 15);
        Assert.Equal(HttpStatusCode.Accepted, (await c.PostAsync($"/api/versions/{vid}/analyze", null)).StatusCode);
        Assert.Equal(0, await BalanceAsync(f, uid));
    }

    [SkippableFact]
    public async Task Pro_Past_Allowance_Without_Credits_Returns_402()
    {
        var f = Factory();
        await TestDb.RequireAsync(f);
        var (c, _, vid) = await SeedAsync(f, grant: 0, pro: true, proUsed: 15);
        await TestContract.AssertEnvelopeAsync(
            await c.PostAsync($"/api/versions/{vid}/analyze", null), HttpStatusCode.PaymentRequired, "insufficient_credits");
    }

    [SkippableFact]
    public async Task Kill_Switch_Off_Charges_Nothing()
    {
        var f = Factory(creditsOn: false);
        await TestDb.RequireAsync(f);
        var (c, uid, vid) = await SeedAsync(f, grant: 500);
        Assert.Equal(HttpStatusCode.Accepted, (await c.PostAsync($"/api/versions/{vid}/analyze", null)).StatusCode);
        Assert.Equal(500, await BalanceAsync(f, uid));
    }

    private sealed class ThrowingQueue : Spectr.Bff.Services.IJobQueue
    {
        public Task EnqueueAsync(string t, object[] a, CancellationToken ct = default) => throw new InvalidOperationException("redis down (test double)");
        public Task EnqueueAsync(string t, object[] a, string q, CancellationToken ct = default) => throw new InvalidOperationException("redis down (test double)");
        public Task EnqueueDelayedAsync(string t, object[] a, string q, TimeSpan d, CancellationToken ct = default) => throw new InvalidOperationException("redis down (test double)");
    }

    // Spec 3.4: the 500 hides the jobId from the client, so the lazy GET /jobs
    // refund can never fire — the enqueue-failure catch must refund itself.
    [SkippableFact]
    public async Task Enqueue_Failure_Refunds_The_Charge_Once()
    {
        var f = Factory();
        await TestDb.RequireAsync(f);
        var (c, uid, vid) = await SeedAsync(f, grant: 500);
        using var broken = f.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll(typeof(Spectr.Bff.Services.IJobQueue));
            s.AddSingleton<Spectr.Bff.Services.IJobQueue>(new ThrowingQueue());
        }));
        var client = broken.CreateClient();
        client.DefaultRequestHeaders.Authorization = c.DefaultRequestHeaders.Authorization;
        try { await client.PostAsync($"/api/versions/{vid}/analyze", null); }
        catch (InvalidOperationException) { /* TestServer rethrows unhandled */ }

        Assert.Equal(500, await BalanceAsync(f, uid));
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var job = await db.AnalysisJobs.AsNoTracking().SingleAsync(j => j.VersionId == vid);
        Assert.Equal("dispatch_failed", job.ErrorCode);
        // The lazy read path must not pay a second time.
        var svc = scope.ServiceProvider.GetRequiredService<CreditLedgerService>();
        await svc.ReverseAsync(uid, job.Id, "dispatch_failed", CancellationToken.None);
        Assert.Equal(500, await BalanceAsync(f, uid));
    }
}
