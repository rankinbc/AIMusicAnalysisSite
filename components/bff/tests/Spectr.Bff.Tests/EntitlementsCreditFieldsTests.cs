using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using Xunit;

namespace Spectr.Bff.Tests;

public sealed class EntitlementsCreditFieldsTests(WebApplicationFactory<Program> baseFactory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    // Real prices for these tests (the suite baseline pins analysis=1).
    private readonly WebApplicationFactory<Program> factory = baseFactory.WithWebHostBuilder(b =>
        b.UseSetting("Credits:Prices:Analysis", "100").UseSetting("Credits:ProAnalysesMonthly", "15"));

    private async Task<Guid> SeedUserAsync(int grant, bool purchase = false, bool pro = false)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var svc = scope.ServiceProvider.GetRequiredService<CreditLedgerService>();
        var uid = Guid.NewGuid();
        db.Users.Add(new User { Id = uid, Email = $"ent+{uid:N}@spectr.test", HashedPassword = "x" });
        if (pro)
            db.Subscriptions.Add(new Subscription { UserId = uid, Status = "active", StripeCustomerId = $"cus_{uid:N}", StripeSubscriptionId = $"sub_{uid:N}", PriceId = "price_test" });
        await db.SaveChangesAsync();
        if (grant > 0) await svc.GrantSignupBonusAsync(uid, grant, CancellationToken.None);
        if (purchase) await svc.PurchaseAsync(uid, 500, $"pi_{uid:N}", $"credits_purchase:t_{uid:N}", CancellationToken.None);
        return uid;
    }

    private async Task<Spectr.Bff.DTOs.EntitlementsDto> EntAsync(Guid uid)
    {
        using var scope = factory.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<EntitlementService>().ForAsync(uid, CancellationToken.None);
    }

    private async Task CleanupAsync(Guid uid)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await TestAuth.AllowPurgeAsync(db);
        await db.CreditLedger.Where(e => e.UserId == uid).ExecuteDeleteAsync();
        await db.Subscriptions.Where(s => s.UserId == uid).ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == uid).ExecuteDeleteAsync();
    }

    [SkippableFact]
    public async Task Granted_Only_User_Is_Credits_Tier_But_Not_Paying()
    {
        await TestDb.RequireAsync(factory);
        var uid = await SeedUserAsync(grant: 500);
        try
        {
            var e = await EntAsync(uid);
            Assert.Equal("credits", e.Tier);
            Assert.Equal(500, e.CreditBalance);
            Assert.False(e.IsPaying);
            Assert.Equal(5, e.AnalysesRemaining);
        }
        finally { await CleanupAsync(uid); }
    }

    [SkippableFact]
    public async Task Balance_Below_Price_Means_Zero_Analyses_Remaining()
    {
        await TestDb.RequireAsync(factory);
        var uid = await SeedUserAsync(grant: 40);
        try { Assert.Equal(0, (await EntAsync(uid)).AnalysesRemaining); }
        finally { await CleanupAsync(uid); }
    }

    [SkippableFact]
    public async Task Purchaser_Is_Paying()
    {
        await TestDb.RequireAsync(factory);
        var uid = await SeedUserAsync(grant: 0, purchase: true);
        try { Assert.True((await EntAsync(uid)).IsPaying); }
        finally { await CleanupAsync(uid); }
    }

    [SkippableFact]
    public async Task Pro_Reports_Allowance_Plus_Credit_Analyses()
    {
        await TestDb.RequireAsync(factory);
        var uid = await SeedUserAsync(grant: 250, pro: true);
        try
        {
            var e = await EntAsync(uid);
            Assert.Equal("pro", e.Tier);
            Assert.True(e.IsPaying);
            Assert.Equal(15, e.ProAnalysesLimit);
            Assert.Equal(0, e.ProAnalysesUsed);
            Assert.Equal(15 + 2, e.AnalysesRemaining);
        }
        finally { await CleanupAsync(uid); }
    }
}