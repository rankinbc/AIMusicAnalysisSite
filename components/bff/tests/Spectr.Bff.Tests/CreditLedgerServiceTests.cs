using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Spectr.Bff.Services;
using Spectr.Data;
using Xunit;
using UserEntity = Spectr.Data.Entities.User;

namespace Spectr.Bff.Tests;

// Story 2.3 / Task 10.1 — unit tests for CreditLedgerService against
// Testcontainers Postgres. Covers Purchase + Spend + Reverse +
// GetBalance + idempotency-key dedupe.

public sealed class CreditLedgerServiceTests
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public CreditLedgerServiceTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory;
    }


    private async Task<Guid> SeedUserAsync(string emailPrefix)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = new UserEntity
        {
            Id = Guid.NewGuid(),
            Email = $"{emailPrefix}+{Guid.NewGuid():N}@spectr.test",
            HashedPassword = "x",
            Handle = $"u{Guid.NewGuid():N}".Substring(0, 12),
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
        await db.UsageEvents.Where(e => e.UserId == userId).ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
    }

    private CreditLedgerService NewService(IServiceScope scope)
    {
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var cache = scope.ServiceProvider.GetRequiredService<Microsoft.Extensions.Caching.Memory.IMemoryCache>();
        return new CreditLedgerService(
            db, cache, NullLogger<CreditLedgerService>.Instance);
    }

    [SkippableFact]
    public async Task PurchaseAsync_Inserts_Plus_Five_Row()
    {
        await TestDb.RequireAsync(_factory);
        var userId = await SeedUserAsync("ledger-purchase");
        try
        {
            using var scope = _factory.Services.CreateScope();
            var svc = NewService(scope);
            var entry = await svc.PurchaseAsync(
                userId, 5, "pi_test_001",
                "credits_purchase:evt_test_001",
                CancellationToken.None);
            Assert.NotNull(entry);
            Assert.Equal(5, entry!.Amount);
            Assert.Equal("purchase", entry.Reason);
            Assert.Equal("pi_test_001", entry.Reference);

            Assert.Equal(5, await svc.GetBalanceAsync(userId, CancellationToken.None));
        }
        finally { await CleanupAsync(userId); }
    }

    [SkippableFact]
    public async Task PurchaseAsync_Duplicate_Idempotency_Key_Is_NoOp()
    {
        await TestDb.RequireAsync(_factory);
        var userId = await SeedUserAsync("ledger-pdup");
        try
        {
            using var scope1 = _factory.Services.CreateScope();
            var svc1 = NewService(scope1);
            var first = await svc1.PurchaseAsync(
                userId, 5, "pi_test_dup",
                "credits_purchase:evt_dup_001",
                CancellationToken.None);
            Assert.NotNull(first);

            using var scope2 = _factory.Services.CreateScope();
            var svc2 = NewService(scope2);
            var second = await svc2.PurchaseAsync(
                userId, 5, "pi_test_dup",
                "credits_purchase:evt_dup_001",
                CancellationToken.None);
            Assert.Null(second);

            // Balance still 5 — second call collapsed on the unique
            // index, no double-credit.
            using var scope3 = _factory.Services.CreateScope();
            var svc3 = NewService(scope3);
            Assert.Equal(5, await svc3.GetBalanceAsync(userId, CancellationToken.None));
        }
        finally { await CleanupAsync(userId); }
    }

    [SkippableFact]
    public async Task SpendAsync_Inserts_Matched_Usage_And_Ledger_Rows()
    {
        await TestDb.RequireAsync(_factory);
        var userId = await SeedUserAsync("ledger-spend");
        try
        {
            using var scope = _factory.Services.CreateScope();
            var svc = NewService(scope);
            await svc.PurchaseAsync(
                userId, 5, "pi_seed", "credits_purchase:seed_spend",
                CancellationToken.None);

            var jobId = Guid.NewGuid();
            var spend = await svc.SpendAsync(
                userId, jobId, "2026-06", CancellationToken.None);
            Assert.Equal(-1, spend.Amount);
            Assert.Equal("spend", spend.Reason);
            Assert.Equal(jobId.ToString(), spend.Reference);

            using var verifyScope = _factory.Services.CreateScope();
            var db = verifyScope.ServiceProvider.GetRequiredService<AppDbContext>();
            var usage = await db.UsageEvents
                .Where(e => e.UserId == userId && e.Reference == jobId.ToString())
                .FirstAsync();
            Assert.Equal("analysis", usage.EventType);
            Assert.Equal("2026-06", usage.BillingPeriod);

            // Balance = 5 (purchase) + -1 (spend) = 4.
            var freshSvc = NewService(verifyScope);
            Assert.Equal(4, await freshSvc.GetBalanceAsync(userId, CancellationToken.None));
        }
        finally { await CleanupAsync(userId); }
    }

    [SkippableFact]
    public async Task SpendAsync_Throws_On_Zero_Balance_And_Writes_Nothing()
    {
        await TestDb.RequireAsync(_factory);
        var userId = await SeedUserAsync("ledger-empty");
        try
        {
            using var scope = _factory.Services.CreateScope();
            var svc = NewService(scope);
            var jobId = Guid.NewGuid();
            var ex = await Assert.ThrowsAsync<InsufficientCreditsException>(
                () => svc.SpendAsync(userId, jobId, "2026-06", CancellationToken.None));
            Assert.Equal(0, ex.CurrentBalance);

            // No ledger row, no usage_events row was written.
            using var verifyScope = _factory.Services.CreateScope();
            var db = verifyScope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Equal(0, await db.CreditLedger.CountAsync(e => e.UserId == userId));
            Assert.Equal(0, await db.UsageEvents.CountAsync(e => e.UserId == userId));
        }
        finally { await CleanupAsync(userId); }
    }

    [SkippableFact]
    public async Task ReverseAsync_Inserts_Plus_One_With_IdempotencyKey()
    {
        await TestDb.RequireAsync(_factory);
        var userId = await SeedUserAsync("ledger-reverse");
        try
        {
            using var scope = _factory.Services.CreateScope();
            var svc = NewService(scope);
            await svc.PurchaseAsync(userId, 5, "pi_rev",
                "credits_purchase:rev_seed", CancellationToken.None);
            var jobId = Guid.NewGuid();
            await svc.SpendAsync(userId, jobId, "2026-06", CancellationToken.None);

            var reversal = await svc.ReverseAsync(
                userId, jobId, "invalid_file", CancellationToken.None);
            Assert.NotNull(reversal);
            Assert.Equal(1, reversal!.Amount);
            Assert.Equal("reversal", reversal.Reason);
            Assert.Equal($"reversal:{jobId}", reversal.IdempotencyKey);

            // Balance restored: 5 - 1 + 1 = 5.
            Assert.Equal(5, await svc.GetBalanceAsync(userId, CancellationToken.None));
        }
        finally { await CleanupAsync(userId); }
    }

    [SkippableFact]
    public async Task ReverseAsync_Second_Call_For_Same_Job_Is_NoOp()
    {
        await TestDb.RequireAsync(_factory);
        var userId = await SeedUserAsync("ledger-rev-dup");
        try
        {
            using var scope = _factory.Services.CreateScope();
            var svc = NewService(scope);
            await svc.PurchaseAsync(userId, 5, "pi_revdup",
                "credits_purchase:revdup_seed", CancellationToken.None);
            var jobId = Guid.NewGuid();
            await svc.SpendAsync(userId, jobId, "2026-06", CancellationToken.None);

            var first = await svc.ReverseAsync(
                userId, jobId, "invalid_file", CancellationToken.None);
            Assert.NotNull(first);

            using var scope2 = _factory.Services.CreateScope();
            var svc2 = NewService(scope2);
            var second = await svc2.ReverseAsync(
                userId, jobId, "invalid_file", CancellationToken.None);
            Assert.Null(second);

            // Still only one reversal row → balance is restored once,
            // not twice.
            using var scope3 = _factory.Services.CreateScope();
            var svc3 = NewService(scope3);
            Assert.Equal(5, await svc3.GetBalanceAsync(userId, CancellationToken.None));
        }
        finally { await CleanupAsync(userId); }
    }

    [SkippableFact]
    public async Task GetBalanceAsync_Sums_Across_Mixed_Entries()
    {
        await TestDb.RequireAsync(_factory);
        var userId = await SeedUserAsync("ledger-sum");
        try
        {
            using var scope = _factory.Services.CreateScope();
            var svc = NewService(scope);
            // +10 purchase, -1 spend, -1 spend, +1 reversal = 9.
            await svc.PurchaseAsync(userId, 10, "pi_sum",
                "credits_purchase:sum_seed", CancellationToken.None);
            var job1 = Guid.NewGuid();
            var job2 = Guid.NewGuid();
            await svc.SpendAsync(userId, job1, "2026-06", CancellationToken.None);
            await svc.SpendAsync(userId, job2, "2026-06", CancellationToken.None);
            await svc.ReverseAsync(userId, job1, "invalid_file", CancellationToken.None);

            Assert.Equal(9, await svc.GetBalanceAsync(userId, CancellationToken.None));
        }
        finally { await CleanupAsync(userId); }
    }
}
