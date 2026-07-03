using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Collections.Concurrent;
using Xunit;
using UserEntity = Spectr.Data.Entities.User;

namespace Spectr.Bff.Tests;

// Story 3.4 — the nightly retention driver: warning emails at exactly the
// configured day boundaries + sweep_retention enqueued on `maintenance`.
public sealed class RetentionSweepSchedulerTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private sealed class RecordingEmailSender : IEmailSender
    {
        public ConcurrentQueue<(string To, string Template, IReadOnlyDictionary<string, string> Data)> Sent { get; } = new();

        public Task SendAsync(string toEmail, string template,
            IReadOnlyDictionary<string, string> data, CancellationToken ct = default)
        {
            Sent.Enqueue((toEmail, template, data));
            return Task.CompletedTask;
        }
    }

    private sealed class RecordingQueue : IJobQueue
    {
        public ConcurrentQueue<(string Task, string Queue)> Calls { get; } = new();

        public Task EnqueueAsync(string taskName, object[] args, CancellationToken ct = default)
        { Calls.Enqueue((taskName, DramatiqQueues.Default)); return Task.CompletedTask; }

        public Task EnqueueAsync(string taskName, object[] args, string queueName, CancellationToken ct = default)
        { Calls.Enqueue((taskName, queueName)); return Task.CompletedTask; }

        public Task EnqueueDelayedAsync(string taskName, object[] args, string queueName, TimeSpan delay, CancellationToken ct = default)
        { Calls.Enqueue((taskName, queueName)); return Task.CompletedTask; }
    }

    private (RetentionSweepScheduler Scheduler, RecordingEmailSender Email, RecordingQueue Queue,
        WebApplicationFactory<Program> Factory) Build(RetentionOptions? opts = null)
    {
        var email = new RecordingEmailSender();
        var queue = new RecordingQueue();
        var f = _factory.WithWebHostBuilder(b =>
        {
            // The app registers its own hosted RetentionSweepScheduler which
            // runs once at host start — disable it so only the instance under
            // test writes into the recorders.
            b.UseSetting("Retention:Enabled", "false");
            b.ConfigureServices(s =>
            {
                s.AddSingleton<IEmailSender>(email);
                s.AddSingleton<IJobQueue>(queue);
            });
        });
        var scheduler = new RetentionSweepScheduler(
            f.Services.GetRequiredService<IServiceScopeFactory>(),
            Microsoft.Extensions.Options.Options.Create(opts ?? new RetentionOptions()),
            NullLogger<RetentionSweepScheduler>.Instance);
        return (scheduler, email, queue, f);
    }

    private static async Task<Guid> SeedLapsedUserAsync(
        WebApplicationFactory<Program> f, int daysUntilPurge, int lapsedDays)
    {
        var userId = Guid.NewGuid();
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Users.Add(new UserEntity
        {
            Id = userId,
            Email = $"ret+{userId:N}@spectr.test",
            HashedPassword = "x",
        });
        db.Subscriptions.Add(new Subscription
        {
            UserId = userId,
            Status = "canceled",
            // purgeDate = period_end + lapsedDays; want purge in `daysUntilPurge`.
            CurrentPeriodEnd = DateTimeOffset.UtcNow.AddDays(daysUntilPurge - lapsedDays),
            PriceId = "price_test",
            StripeCustomerId = $"cus_{userId:N}",
            StripeSubscriptionId = $"sub_{userId:N}",
        });
        await db.SaveChangesAsync();
        return userId;
    }

    private static async Task CleanupAsync(WebApplicationFactory<Program> f, Guid userId)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Subscriptions.Where(s => s.UserId == userId).ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
    }

    [Fact]
    public async Task Warns_Due_Tiers_Once_And_Enqueues_Sweep()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (scheduler, email, queue, f) = Build();
        var warnUser = await SeedLapsedUserAsync(f, daysUntilPurge: 7, lapsedDays: 90);
        // 5 days left: the 7-day tier is DUE (<= semantics — a host down on
        // the exact boundary day must not mean "never warned").
        var lateUser = await SeedLapsedUserAsync(f, daysUntilPurge: 5, lapsedDays: 90);
        // 20 days left: no tier due yet.
        var earlyUser = await SeedLapsedUserAsync(f, daysUntilPurge: 20, lapsedDays: 90);
        try
        {
            await scheduler.RunOnceAsync(CancellationToken.None);

            var sent = email.Sent.ToList();
            Assert.Contains(sent, s => s.To.Contains($"{warnUser:N}") && s.Template == "retention-warning");
            Assert.Contains(sent, s => s.To.Contains($"{lateUser:N}"));
            Assert.DoesNotContain(sent, s => s.To.Contains($"{earlyUser:N}"));

            // The authoritative sweep always enqueues, on the maintenance
            // lane, carrying the policy value (single source, no drift).
            Assert.Contains(queue.Calls, c =>
                c.Task == DramatiqTasks.SweepRetention && c.Queue == DramatiqQueues.Maintenance);

            // Ledger dedupe: a second run (redeploy / extra replica) sends
            // NOTHING new — the digest-keyed notifications row absorbs it.
            var before = email.Sent.Count;
            await scheduler.RunOnceAsync(CancellationToken.None);
            Assert.Equal(before, email.Sent.Count);
        }
        finally
        {
            await CleanupNotificationsAsync(f, warnUser, lateUser, earlyUser);
            await CleanupAsync(f, warnUser);
            await CleanupAsync(f, lateUser);
            await CleanupAsync(f, earlyUser);
        }
    }

    private static async Task CleanupNotificationsAsync(WebApplicationFactory<Program> f, params Guid[] userIds)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Notifications.Where(n => userIds.Contains(n.RecipientUserId)).ExecuteDeleteAsync();
    }

    [Fact]
    public async Task Disabled_Flag_Short_Circuits()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (scheduler, email, queue, _) = Build(new RetentionOptions { Enabled = false });
        await scheduler.RunOnceAsync(CancellationToken.None);
        Assert.Empty(email.Sent);
        Assert.Empty(queue.Calls);
    }

    [Fact]
    public async Task Resubscribed_User_Gets_No_Warning()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (scheduler, email, _, f) = Build();
        var userId = await SeedLapsedUserAsync(f, daysUntilPurge: 7, lapsedDays: 90);
        try
        {
            // Credits purchased after the lapse — a paid signal wins.
            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.CreditLedger.Add(new CreditLedgerEntry
                {
                    UserId = userId,
                    Amount = 2,
                    Reason = "purchase",
                    IdempotencyKey = $"test:{userId:N}",
                });
                await db.SaveChangesAsync();
            }

            await scheduler.RunOnceAsync(CancellationToken.None);
            Assert.DoesNotContain(email.Sent, s => s.To.Contains($"{userId:N}"));
        }
        finally
        {
            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.CreditLedger.Where(e => e.UserId == userId).ExecuteDeleteAsync();
            await CleanupAsync(f, userId);
        }
    }
}
