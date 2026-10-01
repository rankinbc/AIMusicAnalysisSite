using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using Xunit;

namespace Spectr.Bff.Tests;

public sealed class SignupBonusBackfillTests(WebApplicationFactory<Program> baseFactory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private WebApplicationFactory<Program> F(string enabled = "true") =>
        baseFactory.WithWebHostBuilder(b => b
            .UseSetting("Credits:SignupGrant", "500")
            .UseSetting("Credits:Enabled", enabled));

    private static async Task<Guid> SeedUserAsync(AppDbContext db, bool verified, bool guest = false)
    {
        var id = Guid.NewGuid();
        db.Users.Add(new User
        {
            Id = id, Email = $"bf+{id:N}@spectr.test", HashedPassword = "x",
            EmailVerifiedAt = verified ? DateTimeOffset.UtcNow : null, IsGuest = guest,
        });
        await db.SaveChangesAsync();
        return id;
    }

    private static Task<int> BalanceAsync(IServiceProvider sp, Guid uid)
        => sp.GetRequiredService<CreditLedgerService>().GetBalanceAsync(uid, CancellationToken.None);

    [SkippableFact]
    public async Task Backfill_Grants_Verified_Users_Once_And_Skips_Unverified_And_Guests()
    {
        var f = F();
        await TestDb.RequireAsync(f);
        using var scope = f.Services.CreateScope();
        var sp = scope.ServiceProvider;
        var db = sp.GetRequiredService<AppDbContext>();
        var verified = await SeedUserAsync(db, verified: true);
        var pending = await SeedUserAsync(db, verified: false);
        var guest = await SeedUserAsync(db, verified: true, guest: true);
        var already = await SeedUserAsync(db, verified: true);
        await sp.GetRequiredService<CreditLedgerService>().GrantSignupBonusAsync(already, 500, CancellationToken.None);
        try
        {
            var svc = sp.GetRequiredService<SignupBonusBackfill>();
            Assert.True(await svc.RunAsync(CancellationToken.None) >= 1);
            await svc.RunAsync(CancellationToken.None); // second run: no double grant

            Assert.Equal(500, await BalanceAsync(sp, verified));
            Assert.Equal(0, await BalanceAsync(sp, pending));
            Assert.Equal(0, await BalanceAsync(sp, guest));
            Assert.Equal(500, await BalanceAsync(sp, already));
        }
        finally
        {
            await TestAuth.AllowPurgeAsync(db);
            var ids = new[] { verified, pending, guest, already };
            await db.CreditLedger.Where(e => ids.Contains(e.UserId)).ExecuteDeleteAsync();
            await db.Users.Where(u => ids.Contains(u.Id)).ExecuteDeleteAsync();
        }
    }

    [SkippableFact]
    public async Task Backfill_Is_A_NoOp_When_Credits_Are_Off()
    {
        var f = F(enabled: "false");
        await TestDb.RequireAsync(f);
        using var scope = f.Services.CreateScope();
        Assert.Equal(0, await scope.ServiceProvider.GetRequiredService<SignupBonusBackfill>().RunAsync(CancellationToken.None));
    }
}
