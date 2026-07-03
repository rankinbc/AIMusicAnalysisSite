using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using Xunit;
using UserEntity = Spectr.Data.Entities.User;

namespace Spectr.Bff.Tests;

// Story 2.4 / Task 11.1 — EntitlementService resolver tests.
// 7 cases: free (0 used), free (3 used / exhausted), credits, pro-active,
// pro-past_due, cache-invalidation, flag override.

public sealed class EntitlementServiceTests
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public EntitlementServiceTests(WebApplicationFactory<Program> factory)
        => _factory = factory;

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

    private async Task<Guid> SeedUserAsync(string prefix)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = new UserEntity
        {
            Id = Guid.NewGuid(),
            Email = $"{prefix}+{Guid.NewGuid():N}@spectr.test",
            HashedPassword = "x",
            Handle = $"e{Guid.NewGuid():N}".Substring(0, 12),
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user.Id;
    }

    private async Task CleanupAsync(Guid userId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.UsageEvents.Where(e => e.UserId == userId).ExecuteDeleteAsync();
        await TestAuth.AllowPurgeAsync(db);
        await db.CreditLedger.Where(e => e.UserId == userId).ExecuteDeleteAsync();
        await db.Subscriptions.Where(s => s.UserId == userId).ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
    }

    private async Task<EntitlementService> NewServiceAsync(IServiceScope scope)
    {
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        // Fresh cache so each test starts cold.
        var cache = new MemoryCache(new MemoryCacheOptions());
        // Pre-seed feature flags so the service finds them.
        var flags = await db.FeatureFlags.AsNoTracking().ToListAsync();
        if (!flags.Any(f => f.Name == "free_analyses_per_month"))
        {
            db.FeatureFlags.Add(new FeatureFlag { Name = "free_analyses_per_month", Value = "3" });
            db.FeatureFlags.Add(new FeatureFlag { Name = "coach_free_followups", Value = "3" });
            db.FeatureFlags.Add(new FeatureFlag { Name = "history_depth_free", Value = "10" });
            db.FeatureFlags.Add(new FeatureFlag { Name = "history_depth_credits", Value = "30" });
            try { await db.SaveChangesAsync(); } catch { /* seeded by migration */ }
        }
        return new EntitlementService(db, cache, NullLogger<EntitlementService>.Instance);
    }

    // ── Case (a) free user, 0 used → remaining = 3 ──────────────────────────
    [Fact]
    public async Task Free_ZeroUsed_Remaining3()
    {
        if (!await PostgresReachable()) return;
        var userId = await SeedUserAsync("ent-a");
        try
        {
            using var scope = _factory.Services.CreateScope();
            var svc = await NewServiceAsync(scope);
            var ent = await svc.ForAsync(userId, CancellationToken.None);
            Assert.Equal("free", ent.Tier);
            Assert.Equal(3, ent.AnalysesRemaining);
            Assert.False(ent.StemsEnabled);
            Assert.False(ent.AlsEnabled);
            Assert.False(ent.FullVerdictsEnabled);
            Assert.Equal(10, ent.HistoryDepth);
            // Story 2.7 — UpgradeSheet header source: "{used} of {limit}".
            Assert.Equal(3, ent.AnalysesLimit);
            Assert.Equal(0, ent.AnalysesUsed);
            // Story 2.8 — usage-page coach pool + analyses reset.
            Assert.NotNull(ent.Coach);
            Assert.Equal("analysis", ent.Coach!.Scope);
            Assert.Equal(3, ent.Coach.Limit);
            Assert.NotNull(ent.AnalysesResetsAt);
        }
        finally { await CleanupAsync(userId); }
    }

    // ── Case (b) free user, 3 used → remaining = 0 (exhausted) ─────────────
    [Fact]
    public async Task Free_ThreeUsed_RemainingZero()
    {
        if (!await PostgresReachable()) return;
        var userId = await SeedUserAsync("ent-b");
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var period = DateTimeOffset.UtcNow.ToString("yyyy-MM");
            for (var i = 0; i < 3; i++)
            {
                db.UsageEvents.Add(new UsageEvent
                {
                    UserId = userId,
                    EventType = "analysis",
                    BillingPeriod = period,
                    Reference = Guid.NewGuid().ToString(),
                });
            }
            await db.SaveChangesAsync();

            var svc = await NewServiceAsync(scope);
            var ent = await svc.ForAsync(userId, CancellationToken.None);
            Assert.Equal("free", ent.Tier);
            Assert.Equal(0, ent.AnalysesRemaining);
            // Story 2.7 — at the cap, used == limit ("3 of 3 used this month").
            Assert.Equal(3, ent.AnalysesLimit);
            Assert.Equal(3, ent.AnalysesUsed);
        }
        finally { await CleanupAsync(userId); }
    }

    // ── Story 3.2 (AR16) — an invalid_file failure restores the free slot ──
    // Also proves the EF subquery (j.Id.ToString() == e.Reference) translates.
    [Fact]
    public async Task Free_InvalidFileJob_DoesNotConsumeMonthlyCap()
    {
        if (!await PostgresReachable()) return;
        var userId = await SeedUserAsync("ent-inv");
        Guid jobId = Guid.NewGuid(), songId = Guid.NewGuid(), versionId = Guid.NewGuid();
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var period = DateTimeOffset.UtcNow.ToString("yyyy-MM");
            db.Songs.Add(new Song { Id = songId, UserId = userId, Name = "T" });
            db.SongVersions.Add(new SongVersion
            { Id = versionId, SongId = songId, VersionNumber = 1, FilePath = "x", IsCurrent = true });
            // Two dispatched analyses this month; one failed validation.
            db.AnalysisJobs.Add(new AnalysisJob
            { Id = jobId, UserId = userId, VersionId = versionId, Status = "failed", ErrorCode = "invalid_file" });
            db.UsageEvents.Add(new UsageEvent
            { UserId = userId, EventType = "analysis", BillingPeriod = period, Reference = jobId.ToString() });
            db.UsageEvents.Add(new UsageEvent
            { UserId = userId, EventType = "analysis", BillingPeriod = period, Reference = Guid.NewGuid().ToString() });
            await db.SaveChangesAsync();

            var svc = await NewServiceAsync(scope);
            var ent = await svc.ForAsync(userId, CancellationToken.None);
            Assert.Equal("free", ent.Tier);
            Assert.Equal(1, ent.AnalysesUsed);      // invalid_file job excluded
            Assert.Equal(2, ent.AnalysesRemaining); // slot restored
        }
        finally
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.AnalysisJobs.Where(j => j.Id == jobId).ExecuteDeleteAsync();
            await db.SongVersions.Where(v => v.Id == versionId).ExecuteDeleteAsync();
            await db.Songs.Where(s => s.Id == songId).ExecuteDeleteAsync();
            await CleanupAsync(userId);
        }
    }

    // ── Case (c) credits balance = 2 → tier = "credits", remaining = 2 ─────
    [Fact]
    public async Task Credits_Balance2_TierCredits_Remaining2()
    {
        if (!await PostgresReachable()) return;
        var userId = await SeedUserAsync("ent-c");
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.CreditLedger.Add(new CreditLedgerEntry
            {
                UserId = userId,
                Amount = 2,
                Reason = "purchase",
                Reference = "pi_test",
                IdempotencyKey = $"credits_purchase:evt_{Guid.NewGuid():N}",
            });
            await db.SaveChangesAsync();

            var svc = await NewServiceAsync(scope);
            var ent = await svc.ForAsync(userId, CancellationToken.None);
            Assert.Equal("credits", ent.Tier);
            Assert.Equal(2, ent.AnalysesRemaining);
            Assert.True(ent.StemsEnabled);
            Assert.True(ent.AlsEnabled);
            Assert.True(ent.FullVerdictsEnabled);
            Assert.Equal(30, ent.HistoryDepth);
            // Story 2.8 — credits coach pool is unlimited; no analyses reset.
            Assert.Equal("unlimited", ent.Coach!.Scope);
            Assert.Null(ent.AnalysesResetsAt);
        }
        finally { await CleanupAsync(userId); }
    }

    // ── Case (d) Pro active → remaining = null (unlimited) ──────────────────
    [Fact]
    public async Task Pro_Active_NullRemaining()
    {
        if (!await PostgresReachable()) return;
        var userId = await SeedUserAsync("ent-d");
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Subscriptions.Add(new Subscription
            {
                UserId = userId,
                StripeCustomerId = "cus_test_d",
                StripeSubscriptionId = "sub_test_d",
                Status = "active",
                PriceId = "price_test",
                CurrentPeriodEnd = DateTimeOffset.UtcNow.AddDays(30),
            });
            await db.SaveChangesAsync();

            var svc = await NewServiceAsync(scope);
            var ent = await svc.ForAsync(userId, CancellationToken.None);
            Assert.Equal("pro", ent.Tier);
            Assert.Null(ent.AnalysesRemaining);
            Assert.Null(ent.HistoryDepth);
            Assert.True(ent.StemsEnabled);
            // Story 2.8 — pro coach pool is pooled monthly with a reset instant;
            // analyses are unlimited so AnalysesResetsAt stays null.
            Assert.Equal("month", ent.Coach!.Scope);
            Assert.NotNull(ent.Coach.ResetsAt);
            Assert.Null(ent.AnalysesResetsAt);
        }
        finally { await CleanupAsync(userId); }
    }

    // ── Case (e) Pro past_due → still tier = "pro" (dunning is story 2.9) ──
    [Fact]
    public async Task Pro_PastDue_StillPro()
    {
        if (!await PostgresReachable()) return;
        var userId = await SeedUserAsync("ent-e");
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Subscriptions.Add(new Subscription
            {
                UserId = userId,
                StripeCustomerId = "cus_test_e",
                StripeSubscriptionId = "sub_test_e",
                Status = "past_due",
                PriceId = "price_test",
                CurrentPeriodEnd = DateTimeOffset.UtcNow.AddDays(10),
            });
            await db.SaveChangesAsync();

            var svc = await NewServiceAsync(scope);
            var ent = await svc.ForAsync(userId, CancellationToken.None);
            Assert.Equal("pro", ent.Tier);
        }
        finally { await CleanupAsync(userId); }
    }

    // ── Case (f) InvalidateAsync clears cache so next call recomputes ────────
    [Fact]
    public async Task InvalidateAsync_ClearsCache()
    {
        if (!await PostgresReachable()) return;
        var userId = await SeedUserAsync("ent-f");
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var cache = new MemoryCache(new MemoryCacheOptions());
            var svc = new EntitlementService(db, cache, NullLogger<EntitlementService>.Instance);

            // First call — free, 0 used.
            var first = await svc.ForAsync(userId, CancellationToken.None);
            Assert.Equal(3, first.AnalysesRemaining);

            // Add usage event; without invalidation, cached value remains.
            var period = DateTimeOffset.UtcNow.ToString("yyyy-MM");
            db.UsageEvents.Add(new UsageEvent
            {
                UserId = userId,
                EventType = "analysis",
                BillingPeriod = period,
                Reference = Guid.NewGuid().ToString(),
            });
            await db.SaveChangesAsync();

            // Still 3 from cache.
            var cached = await svc.ForAsync(userId, CancellationToken.None);
            Assert.Equal(3, cached.AnalysesRemaining);

            // Invalidate → recomputes from DB.
            svc.InvalidateAsync(userId);
            var fresh = await svc.ForAsync(userId, CancellationToken.None);
            Assert.Equal(2, fresh.AnalysesRemaining);
        }
        finally { await CleanupAsync(userId); }
    }

    // ── Case (g) feature flag free_analyses_per_month=5 overrides default 3 ─
    [Fact]
    public async Task FreeAnalysesCap_FlagOverride()
    {
        if (!await PostgresReachable()) return;
        var userId = await SeedUserAsync("ent-g");
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            // Override the flag (merge with migration seed).
            var existing = await db.FeatureFlags.FindAsync("free_analyses_per_month");
            if (existing is not null)
                existing.Value = "5";
            else
                db.FeatureFlags.Add(new FeatureFlag { Name = "free_analyses_per_month", Value = "5" });
            await db.SaveChangesAsync();

            var svc = await NewServiceAsync(scope);
            var ent = await svc.ForAsync(userId, CancellationToken.None);
            Assert.Equal("free", ent.Tier);
            Assert.Equal(5, ent.AnalysesRemaining);
        }
        finally
        {
            // Restore flag so other tests aren't affected.
            using var restoreScope = _factory.Services.CreateScope();
            var restoreDb = restoreScope.ServiceProvider.GetRequiredService<AppDbContext>();
            var flag = await restoreDb.FeatureFlags.FindAsync("free_analyses_per_month");
            if (flag is not null) { flag.Value = "3"; await restoreDb.SaveChangesAsync(); }
            await CleanupAsync(userId);
        }
    }

    // ── Story 2.9 case (h) terminal `canceled` → degrades to free ──────────
    // AC #2: when Stripe Smart Retries exhaust and the subscription reaches a
    // terminal state, the tier degrades to Free (no credits on hand).
    [Fact]
    public async Task Canceled_NoCredits_DegradesToFree()
    {
        if (!await PostgresReachable()) return;
        var userId = await SeedUserAsync("ent-h");
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Subscriptions.Add(new Subscription
            {
                UserId = userId,
                StripeCustomerId = "cus_test_h",
                StripeSubscriptionId = "sub_test_h",
                Status = "canceled",
                PriceId = "price_test",
                CurrentPeriodEnd = DateTimeOffset.UtcNow.AddDays(-1),
            });
            await db.SaveChangesAsync();

            var svc = await NewServiceAsync(scope);
            var ent = await svc.ForAsync(userId, CancellationToken.None);
            Assert.Equal("free", ent.Tier);
            // Pro depth locks (the BlurLock-gated inputs) — AC #2.
            Assert.False(ent.StemsEnabled);
            Assert.False(ent.AlsEnabled);
            Assert.False(ent.FullVerdictsEnabled);
        }
        finally { await CleanupAsync(userId); }
    }

    // ── Story 2.9 case (i) terminal `unpaid` → degrades to free ────────────
    [Fact]
    public async Task Unpaid_NoCredits_DegradesToFree()
    {
        if (!await PostgresReachable()) return;
        var userId = await SeedUserAsync("ent-i");
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Subscriptions.Add(new Subscription
            {
                UserId = userId,
                StripeCustomerId = "cus_test_i",
                StripeSubscriptionId = "sub_test_i",
                Status = "unpaid",
                PriceId = "price_test",
                CurrentPeriodEnd = DateTimeOffset.UtcNow.AddDays(-1),
            });
            await db.SaveChangesAsync();

            var svc = await NewServiceAsync(scope);
            var ent = await svc.ForAsync(userId, CancellationToken.None);
            Assert.Equal("free", ent.Tier);
            Assert.False(ent.StemsEnabled);
        }
        finally { await CleanupAsync(userId); }
    }

    // ── Story 2.9 case (j) terminal `canceled` WITH credit balance →
    // falls through to the credits tier (still no Pro subscription, but the
    // user retains à-la-carte access — results-forever is unaffected). ─────
    [Fact]
    public async Task Canceled_WithCredits_FallsThroughToCredits()
    {
        if (!await PostgresReachable()) return;
        var userId = await SeedUserAsync("ent-j");
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Subscriptions.Add(new Subscription
            {
                UserId = userId,
                StripeCustomerId = "cus_test_j",
                StripeSubscriptionId = "sub_test_j",
                Status = "canceled",
                PriceId = "price_test",
                CurrentPeriodEnd = DateTimeOffset.UtcNow.AddDays(-1),
            });
            db.CreditLedger.Add(new CreditLedgerEntry
            {
                UserId = userId,
                Amount = 4,
                Reason = "purchase",
                Reference = "pi_test_j",
                IdempotencyKey = $"credits_purchase:evt_{Guid.NewGuid():N}",
            });
            await db.SaveChangesAsync();

            var svc = await NewServiceAsync(scope);
            var ent = await svc.ForAsync(userId, CancellationToken.None);
            Assert.Equal("credits", ent.Tier);
            Assert.Equal(4, ent.AnalysesRemaining);
        }
        finally { await CleanupAsync(userId); }
    }
}
