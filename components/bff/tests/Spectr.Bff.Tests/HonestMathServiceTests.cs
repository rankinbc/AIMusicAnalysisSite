using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Spectr.Bff.Options;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using Xunit;
using UserEntity = Spectr.Data.Entities.User;

namespace Spectr.Bff.Tests;

// Story 2.8 / FR32 / UX-DR32 — HonestMathService: 90-day credit-purchase spend
// vs Pro-equivalent. Defaults: ProMonthly = 1299 → proEquivalent (3 mo) = 3897;
// CreditPack5 = 1900, CreditPack10 = 3500.
public sealed class HonestMathServiceTests
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public HonestMathServiceTests(WebApplicationFactory<Program> factory)
        => _factory = factory;


    private async Task<Guid> SeedUserAsync(string prefix)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = new UserEntity
        {
            Id = Guid.NewGuid(),
            Email = $"{prefix}+{Guid.NewGuid():N}@spectr.test",
            HashedPassword = "x",
            Handle = $"h{Guid.NewGuid():N}".Substring(0, 12),
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user.Id;
    }

    private async Task CleanupAsync(Guid userId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await TestAuth.AllowPurgeAsync(db);
        await db.CreditLedger.Where(e => e.UserId == userId).ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
    }

    private static HonestMathService NewService(IServiceScope scope)
    {
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var opts = Microsoft.Extensions.Options.Options.Create(new PricingDisplayOptions()); // 1299 / 1900 / 3500
        return new HonestMathService(db, opts);
    }

    private static CreditLedgerEntry Purchase(Guid userId, int amount, DateTimeOffset createdAt)
        => new()
        {
            UserId = userId,
            Amount = amount,
            Reason = "purchase",
            Reference = "pi_test",
            IdempotencyKey = $"credits_purchase:evt_{Guid.NewGuid():N}",
            CreatedAt = createdAt,
        };

    // Two 10-packs in window → 7000c ≥ 3897c → qualifies.
    [SkippableFact]
    public async Task HeavySpender_Qualifies()
    {
        await TestDb.RequireAsync(_factory);
        var userId = await SeedUserAsync("hm-a");
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.CreditLedger.Add(Purchase(userId, 10, DateTimeOffset.UtcNow.AddDays(-10)));
            db.CreditLedger.Add(Purchase(userId, 10, DateTimeOffset.UtcNow.AddDays(-40)));
            await db.SaveChangesAsync();

            var dto = await NewService(scope).ForAsync(userId, CancellationToken.None);
            Assert.True(dto.Qualifies);
            Assert.Equal(7000, dto.CreditsSpentCents);
            Assert.Equal(3897, dto.ProEquivalentCents);
            Assert.Equal(90, dto.PeriodDays);
        }
        finally { await CleanupAsync(userId); }
    }

    // One 5-pack → 1900c < 3897c → does NOT qualify.
    [SkippableFact]
    public async Task LightSpender_DoesNotQualify()
    {
        await TestDb.RequireAsync(_factory);
        var userId = await SeedUserAsync("hm-b");
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.CreditLedger.Add(Purchase(userId, 5, DateTimeOffset.UtcNow.AddDays(-5)));
            await db.SaveChangesAsync();

            var dto = await NewService(scope).ForAsync(userId, CancellationToken.None);
            Assert.False(dto.Qualifies);
            Assert.Equal(1900, dto.CreditsSpentCents);
        }
        finally { await CleanupAsync(userId); }
    }

    // Purchase older than 90 days is excluded from the window.
    [SkippableFact]
    public async Task OldPurchase_Excluded()
    {
        await TestDb.RequireAsync(_factory);
        var userId = await SeedUserAsync("hm-c");
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.CreditLedger.Add(Purchase(userId, 10, DateTimeOffset.UtcNow.AddDays(-100)));
            await db.SaveChangesAsync();

            var dto = await NewService(scope).ForAsync(userId, CancellationToken.None);
            Assert.False(dto.Qualifies);
            Assert.Equal(0, dto.CreditsSpentCents);
        }
        finally { await CleanupAsync(userId); }
    }

    // Non-purchase rows (spend/adjustment) never count toward spend.
    [SkippableFact]
    public async Task NonPurchaseRows_Excluded()
    {
        await TestDb.RequireAsync(_factory);
        var userId = await SeedUserAsync("hm-d");
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.CreditLedger.Add(new CreditLedgerEntry
            {
                UserId = userId, Amount = -1, Reason = "spend",
                Reference = Guid.NewGuid().ToString(),
                CreatedAt = DateTimeOffset.UtcNow.AddDays(-3),
            });
            db.CreditLedger.Add(new CreditLedgerEntry
            {
                UserId = userId, Amount = 10, Reason = "adjustment",
                Reference = "ops",
                CreatedAt = DateTimeOffset.UtcNow.AddDays(-3),
            });
            await db.SaveChangesAsync();

            var dto = await NewService(scope).ForAsync(userId, CancellationToken.None);
            Assert.False(dto.Qualifies);
            Assert.Equal(0, dto.CreditsSpentCents);
        }
        finally { await CleanupAsync(userId); }
    }
}
