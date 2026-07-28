using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
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
        // Host config carries the process-wide Credits:Enabled=true baseline
        // (TestProcessBaseline) so the DB's credits_enabled='false' seed can't
        // flip these tier assertions into premium mode.
        var cfg = scope.ServiceProvider.GetRequiredService<IConfiguration>();
        return new EntitlementService(db, cache, cfg, NullLogger<EntitlementService>.Instance);
    }

    // ── Case (a) free user, 0 used → remaining = 3 ──────────────────────────
    [SkippableFact]
    public async Task Free_ZeroUsed_Remaining3()
    {
        await TestDb.RequireAsync(_factory);
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
    [SkippableFact]
    public async Task Free_ThreeUsed_RemainingZero()
    {
        await TestDb.RequireAsync(_factory);
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
    [SkippableFact]
    public async Task Free_InvalidFileJob_DoesNotConsumeMonthlyCap()
    {
        await TestDb.RequireAsync(_factory);
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
    [SkippableFact]
    public async Task Credits_Balance2_TierCredits_Remaining2()
    {
        await TestDb.RequireAsync(_factory);
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
    [SkippableFact]
    public async Task Pro_Active_NullRemaining()
    {
        await TestDb.RequireAsync(_factory);
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
    [SkippableFact]
    public async Task Pro_PastDue_StillPro()
    {
        await TestDb.RequireAsync(_factory);
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
    [SkippableFact]
    public async Task InvalidateAsync_ClearsCache()
    {
        await TestDb.RequireAsync(_factory);
        var userId = await SeedUserAsync("ent-f");
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var cache = new MemoryCache(new MemoryCacheOptions());
            var cfg = scope.ServiceProvider.GetRequiredService<IConfiguration>();
            var svc = new EntitlementService(db, cache, cfg, NullLogger<EntitlementService>.Instance);

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
    [SkippableFact]
    public async Task FreeAnalysesCap_FlagOverride()
    {
        await TestDb.RequireAsync(_factory);
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
    [SkippableFact]
    public async Task Canceled_NoCredits_DegradesToFree()
    {
        await TestDb.RequireAsync(_factory);
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
    [SkippableFact]
    public async Task Unpaid_NoCredits_DegradesToFree()
    {
        await TestDb.RequireAsync(_factory);
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

    // ── credits_enabled kill switch (k) — config "false" ⇒ everyone premium ─
    // The rest of the suite runs with the process-wide Credits:Enabled=true
    // baseline (TestProcessBaseline); these cases exercise the switch itself.
    [SkippableFact]
    public async Task CreditsDisabled_FreeUserResolvesPremium()
    {
        await TestDb.RequireAsync(_factory);
        var userId = await SeedUserAsync("ent-k");
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var cfg = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                { ["Credits:Enabled"] = "false" })
                .Build();
            var svc = new EntitlementService(
                db, new MemoryCache(new MemoryCacheOptions()), cfg,
                NullLogger<EntitlementService>.Instance);

            // A plain free user (no sub, no credits) resolves as premium.
            var ent = await svc.ForAsync(userId, CancellationToken.None);
            Assert.Equal("pro", ent.Tier);
            Assert.Null(ent.AnalysesRemaining);
            Assert.Null(ent.HistoryDepth);
            Assert.True(ent.StemsEnabled);
            Assert.True(ent.AlsEnabled);
            Assert.True(ent.FullVerdictsEnabled);
            Assert.False(ent.CreditsEnabled);
            // Coach is truly unlimited — NOT pro's pooled-monthly cap.
            Assert.Equal("unlimited", ent.Coach!.Scope);
            Assert.Equal(int.MaxValue, ent.CoachRemaining);
            Assert.False(ent.Coach.CapReached);
        }
        finally { await CleanupAsync(userId); }
    }

    // ── kill switch (l) — DB flag path: no config override, row 'false' ─────
    // Prod flips credits via the feature_flags row alone; prove that path.
    // Safe to mutate the shared row: every other test reads through the
    // Credits:Enabled=true config baseline, which wins over the DB value.
    [SkippableFact]
    public async Task CreditsDisabled_DbFlagAlone_ResolvesPremium()
    {
        await TestDb.RequireAsync(_factory);
        var userId = await SeedUserAsync("ent-l");
        string? originalValue = null;
        var rowExisted = false;
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var flag = await db.FeatureFlags.FindAsync("credits_enabled");
            if (flag is not null) { rowExisted = true; originalValue = flag.Value; flag.Value = "false"; }
            else db.FeatureFlags.Add(new FeatureFlag { Name = "credits_enabled", Value = "false" });
            await db.SaveChangesAsync();

            var emptyCfg = new ConfigurationBuilder().Build();
            var svc = new EntitlementService(
                db, new MemoryCache(new MemoryCacheOptions()), emptyCfg,
                NullLogger<EntitlementService>.Instance);
            var ent = await svc.ForAsync(userId, CancellationToken.None);
            Assert.Equal("pro", ent.Tier);
            Assert.False(ent.CreditsEnabled);
        }
        finally
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var flag = await db.FeatureFlags.FindAsync("credits_enabled");
            if (flag is not null)
            {
                if (rowExisted) flag.Value = originalValue!;
                else db.FeatureFlags.Remove(flag);
                await db.SaveChangesAsync();
            }
            await CleanupAsync(userId);
        }
    }

    // ── kill switch (m) — config "true" beats a DB row of 'false' ───────────
    // This is the exact mechanism the whole test suite rests on.
    [SkippableFact]
    public async Task CreditsEnabled_ConfigTrue_WinsOverDbFalse()
    {
        await TestDb.RequireAsync(_factory);
        var userId = await SeedUserAsync("ent-m");
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            // Regardless of the row's live value, an explicit config "true"
            // must keep the credit system on.
            var cfg = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                { ["Credits:Enabled"] = "true" })
                .Build();
            var svc = new EntitlementService(
                db, new MemoryCache(new MemoryCacheOptions()), cfg,
                NullLogger<EntitlementService>.Instance);
            var ent = await svc.ForAsync(userId, CancellationToken.None);
            Assert.Equal("free", ent.Tier);
            Assert.True(ent.CreditsEnabled);
        }
        finally { await CleanupAsync(userId); }
    }

    // ── kill switch (n) — CoachCapService returns unlimited, not pro pool ───
    [SkippableFact]
    public async Task CreditsDisabled_CoachCapUnlimited()
    {
        await TestDb.RequireAsync(_factory);
        var userId = await SeedUserAsync("ent-n");
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var cfg = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                { ["Credits:Enabled"] = "false" })
                .Build();
            var ents = new EntitlementService(
                db, new MemoryCache(new MemoryCacheOptions()), cfg,
                NullLogger<EntitlementService>.Instance);
            var caps = new CoachCapService(db, ents);

            var state = await caps.ResolveAsync(userId, Guid.NewGuid(), CancellationToken.None);
            Assert.Equal(CoachCapService.ScopeUnlimited, state.Scope);
            Assert.Equal(int.MaxValue, state.Limit);
            Assert.False(state.CapReached);
        }
        finally { await CleanupAsync(userId); }
    }

    // ── Story 2.9 case (j) terminal `canceled` WITH credit balance →
    // falls through to the credits tier (still no Pro subscription, but the
    // user retains à-la-carte access — results-forever is unaffected). ─────
    [SkippableFact]
    public async Task Canceled_WithCredits_FallsThroughToCredits()
    {
        await TestDb.RequireAsync(_factory);
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
