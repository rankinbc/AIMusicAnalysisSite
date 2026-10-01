// components/bff/tests/Spectr.Bff.Tests/CreditLedgerChargeTests.cs
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using Xunit;

namespace Spectr.Bff.Tests;

public sealed class CreditLedgerChargeTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private async Task<(IServiceScope Scope, CreditLedgerService Svc, AppDbContext Db, Guid UserId)> SeedAsync(int balance)
    {
        var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var svc = scope.ServiceProvider.GetRequiredService<CreditLedgerService>();
        var user = new User { Id = Guid.NewGuid(), Email = $"charge+{Guid.NewGuid():N}@spectr.test", HashedPassword = "x" };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        if (balance > 0)
            await svc.GrantSignupBonusAsync(user.Id, balance, CancellationToken.None);
        return (scope, svc, db, user.Id);
    }

    private static async Task CleanupAsync(AppDbContext db, Guid userId)
    {
        await TestAuth.AllowPurgeAsync(db);
        await db.CreditLedger.Where(e => e.UserId == userId).ExecuteDeleteAsync();
        await db.UsageEvents.Where(e => e.UserId == userId).ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
    }

    [SkippableFact]
    public async Task Charge_Deducts_Amount_And_Writes_Usage_Event()
    {
        await TestDb.RequireAsync(factory);
        var (scope, svc, db, uid) = await SeedAsync(500);
        try
        {
            var row = await svc.ChargeAsync(uid, 100, "job:1", "spend:analysis:1", "analysis", CancellationToken.None);
            Assert.NotNull(row);
            Assert.Equal(-100, row!.Amount);
            Assert.Equal(400, await svc.GetBalanceAsync(uid, CancellationToken.None));
            Assert.Equal(1, await db.UsageEvents.CountAsync(e => e.UserId == uid && e.EventType == "analysis"));
        }
        finally { await CleanupAsync(db, uid); scope.Dispose(); }
    }

    [SkippableFact]
    public async Task Charge_Same_Key_Twice_Charges_Once()
    {
        await TestDb.RequireAsync(factory);
        var (scope, svc, db, uid) = await SeedAsync(500);
        try
        {
            await svc.ChargeAsync(uid, 5, "msg:1", "spend:coach:1", null, CancellationToken.None);
            var second = await svc.ChargeAsync(uid, 5, "msg:1", "spend:coach:1", null, CancellationToken.None);
            Assert.Null(second);
            Assert.Equal(495, await svc.GetBalanceAsync(uid, CancellationToken.None));
        }
        finally { await CleanupAsync(db, uid); scope.Dispose(); }
    }

    [SkippableFact]
    public async Task Charge_More_Than_Balance_Throws_With_Required_And_Writes_Nothing()
    {
        await TestDb.RequireAsync(factory);
        var (scope, svc, db, uid) = await SeedAsync(40);
        try
        {
            var ex = await Assert.ThrowsAsync<InsufficientCreditsException>(() =>
                svc.ChargeAsync(uid, 100, "job:2", "spend:analysis:2", "analysis", CancellationToken.None));
            Assert.Equal(40, ex.CurrentBalance);
            Assert.Equal(100, ex.Required);
            Assert.Equal(40, await svc.GetBalanceAsync(uid, CancellationToken.None));
            Assert.Equal(0, await db.UsageEvents.CountAsync(e => e.UserId == uid));
        }
        finally { await CleanupAsync(db, uid); scope.Dispose(); }
    }

    [SkippableFact]
    public async Task Refund_Returns_Exactly_What_Was_Charged_Once()
    {
        await TestDb.RequireAsync(factory);
        var (scope, svc, db, uid) = await SeedAsync(500);
        try
        {
            await svc.ChargeAsync(uid, 15, "specialist:a:low_end", "spend:specialist:a:low_end", null, CancellationToken.None);
            var r1 = await svc.RefundChargeAsync(uid, "specialist:a:low_end", "reversal:specialist:a:low_end", CancellationToken.None);
            var r2 = await svc.RefundChargeAsync(uid, "specialist:a:low_end", "reversal:specialist:a:low_end", CancellationToken.None);
            Assert.Equal(15, r1!.Amount);
            Assert.Null(r2);
            Assert.Equal(500, await svc.GetBalanceAsync(uid, CancellationToken.None));
        }
        finally { await CleanupAsync(db, uid); scope.Dispose(); }
    }

    [SkippableFact]
    public async Task Refund_Of_Never_Charged_Reference_Mints_Nothing()
    {
        await TestDb.RequireAsync(factory);
        var (scope, svc, db, uid) = await SeedAsync(0);
        try
        {
            Assert.Null(await svc.RefundChargeAsync(uid, "job:never", "reversal:never", CancellationToken.None));
            Assert.Equal(0, await svc.GetBalanceAsync(uid, CancellationToken.None));
        }
        finally { await CleanupAsync(db, uid); scope.Dispose(); }
    }
}
