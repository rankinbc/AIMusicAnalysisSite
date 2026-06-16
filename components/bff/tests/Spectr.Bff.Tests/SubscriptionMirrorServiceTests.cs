using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Spectr.Bff.Services;
using Spectr.Data;
using Stripe;
using Xunit;
using SubscriptionEntity = Spectr.Data.Entities.Subscription;
using UserEntity = Spectr.Data.Entities.User;

namespace Spectr.Bff.Tests;

// Story 2.1 review-fix P4 / Task 5.5 — isolated unit tests for the
// SubscriptionMirrorService against a Postgres-reachable AppDbContext.
// Cases:
//   (a) first apply for a user inserts a row
//   (b) second apply with changed status mutates the existing row
//   (c) apply with unknown customer + missing metadata is a no-op
//
// The integration tests in StripeWebhookEndpointTests cover the
// end-to-end webhook path; these cover the service surface directly
// so future refactors of the dispatch wiring don't lose coverage.
public sealed class SubscriptionMirrorServiceTests
    : IClassFixture<Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program>>
{
    private readonly Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program> _factory;

    public SubscriptionMirrorServiceTests(
        Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program> factory)
    {
        _factory = factory;
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

    private static Subscription StripeSub(
        Guid userId,
        string customerId,
        string status,
        string priceId = "price_test_monthly",
        string? subId = null)
        => new Subscription
        {
            Id = subId ?? $"sub_test_{Guid.NewGuid():N}",
            CustomerId = customerId,
            Status = status,
            Metadata = new Dictionary<string, string>
            {
                ["spectr_user_id"] = userId.ToString(),
            },
            Items = new StripeList<SubscriptionItem>
            {
                Data = new List<SubscriptionItem>
                {
                    new SubscriptionItem
                    {
                        Id = "si_test_001",
                        CurrentPeriodEnd = DateTime.UtcNow.AddDays(30),
                        Price = new Price { Id = priceId },
                    },
                },
            },
        };

    private async Task<Guid> SeedUserAsync(string email, string? customerId = null)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = new UserEntity
        {
            Id = Guid.NewGuid(),
            Email = email,
            HashedPassword = "x",
            Handle = $"u{Guid.NewGuid():N}".Substring(0, 12),
            StripeCustomerId = customerId,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user.Id;
    }

    private async Task CleanupAsync(Guid userId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Subscriptions.Where(s => s.UserId == userId).ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
    }

    [Fact]
    public async Task First_Apply_For_A_User_Inserts_A_Row()
    {
        if (!await PostgresReachable()) { return; }
        var userId = await SeedUserAsync(
            $"mirror+first+{Guid.NewGuid():N}@spectr.test");
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var service = new SubscriptionMirrorService(
                db, NullLogger<SubscriptionMirrorService>.Instance);

            var stripeSub = StripeSub(userId, "cus_first_001", "active");
            await service.ApplyAsync(stripeSub, CancellationToken.None);

            var row = await db.Subscriptions
                .FirstAsync(s => s.UserId == userId);
            Assert.Equal("active", row.Status);
            Assert.Equal("cus_first_001", row.StripeCustomerId);
            Assert.Equal(stripeSub.Id, row.StripeSubscriptionId);
            Assert.Equal("price_test_monthly", row.PriceId);
        }
        finally { await CleanupAsync(userId); }
    }

    [Fact]
    public async Task Second_Apply_With_Changed_Status_Mutates_Existing_Row()
    {
        if (!await PostgresReachable()) { return; }
        var userId = await SeedUserAsync(
            $"mirror+mut+{Guid.NewGuid():N}@spectr.test");
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var service = new SubscriptionMirrorService(
                db, NullLogger<SubscriptionMirrorService>.Instance);

            var subId = $"sub_mut_{Guid.NewGuid():N}";
            await service.ApplyAsync(
                StripeSub(userId, "cus_mut_001", "active", subId: subId),
                CancellationToken.None);
            await service.ApplyAsync(
                StripeSub(userId, "cus_mut_001", "past_due", subId: subId),
                CancellationToken.None);

            var rows = await db.Subscriptions
                .Where(s => s.UserId == userId).ToListAsync();
            Assert.Single(rows);
            Assert.Equal("past_due", rows[0].Status);
        }
        finally { await CleanupAsync(userId); }
    }

    [Fact]
    public async Task Apply_With_Unknown_Customer_And_Missing_Metadata_Is_NoOp()
    {
        if (!await PostgresReachable()) { return; }

        // No seeded user with this customer id, and the subscription
        // payload omits the spectr_user_id metadata — the service should
        // log + return without inserting an orphan row.
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var service = new SubscriptionMirrorService(
            db, NullLogger<SubscriptionMirrorService>.Instance);

        var orphanCustomerId = $"cus_orphan_{Guid.NewGuid():N}";
        var stripeSub = StripeSub(Guid.Empty, orphanCustomerId, "active");
        stripeSub.Metadata = null;  // unset
        await service.ApplyAsync(stripeSub, CancellationToken.None);

        // No row should appear for any user with this orphan customer id.
        var orphanCount = await db.Subscriptions
            .CountAsync(s => s.StripeCustomerId == orphanCustomerId);
        Assert.Equal(0, orphanCount);
    }

    [Fact]
    public async Task Apply_Resolves_User_Via_Existing_StripeCustomerId_On_User_Row()
    {
        if (!await PostgresReachable()) { return; }

        var customerId = $"cus_via_user_{Guid.NewGuid():N}";
        var userId = await SeedUserAsync(
            $"mirror+via+user+{Guid.NewGuid():N}@spectr.test",
            customerId: customerId);
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var service = new SubscriptionMirrorService(
                db, NullLogger<SubscriptionMirrorService>.Instance);

            // Subscription without explicit metadata — service must fall
            // back to looking up users.StripeCustomerId.
            var stripeSub = StripeSub(Guid.Empty, customerId, "active");
            stripeSub.Metadata = null;
            await service.ApplyAsync(stripeSub, CancellationToken.None);

            var row = await db.Subscriptions
                .FirstAsync(s => s.UserId == userId);
            Assert.Equal("active", row.Status);
        }
        finally { await CleanupAsync(userId); }
    }
}
