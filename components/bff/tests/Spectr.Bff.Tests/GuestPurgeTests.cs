using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Xunit;
using UserEntity = Spectr.Data.Entities.User;

namespace Spectr.Bff.Tests;

// Task D7 (spec D8) — the nightly guest-purge pass: every guest with
// guest_expires_at < now (or NULL, D5 ruling) is torn down through the SAME
// path account deletion uses (AccountTeardown), then delete_account_data is
// enqueued. Guests cannot self-delete — this sweep is the ONLY path off an
// expired sandbox. Joins the DemoAuth collection: this class creates real
// `users.is_guest` rows, and DemoAuthEndpointsTests/DemoAuthFixRound1*Tests
// count guest rows relative to a baseline — running in parallel with them
// races those assertions.
[Collection("DemoAuth")]
public sealed class GuestPurgeTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private sealed class RecordingQueue : IJobQueue
    {
        public ConcurrentQueue<(string Task, object[] Args, string Queue)> SentWithArgs { get; } = new();

        public Task EnqueueAsync(string taskName, object[] args, CancellationToken ct = default)
        { SentWithArgs.Enqueue((taskName, args, DramatiqQueues.Default)); return Task.CompletedTask; }

        public Task EnqueueAsync(string taskName, object[] args, string queueName, CancellationToken ct = default)
        { SentWithArgs.Enqueue((taskName, args, queueName)); return Task.CompletedTask; }

        public Task EnqueueDelayedAsync(string taskName, object[] args, string queueName, TimeSpan delay, CancellationToken ct = default)
        { SentWithArgs.Enqueue((taskName, args, queueName)); return Task.CompletedTask; }
    }

    // I6a — a fake that always THROWS for one specific guest id, never
    // touching EF. Everyone else falls through to the real AccountTeardown
    // (resolved from the same scope), so this is a substitution seam, not a
    // mock of EF.
    private sealed class ThrowingTeardown(AccountTeardown inner, Func<Guid> poisonUserId) : IAccountTeardown
    {
        public Task TearDownAsync(UserEntity user, string auditAction, string auditReason, CancellationToken ct) =>
            user.Id == poisonUserId()
                ? throw new InvalidOperationException("simulated teardown failure (GuestPurgeTests I6a)")
                : inner.TearDownAsync(user, auditAction, auditReason, ct);
    }

    private WebApplicationFactory<Program> Build(
        IJobQueue? queue = null, Func<IServiceProvider, IAccountTeardown>? teardownFactory = null) =>
        _factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Demo:Enabled", "true");
            b.UseSetting("Demo:SnapshotKey", "");
            b.ConfigureTestServices(s =>
            {
                if (queue is not null)
                {
                    s.RemoveAll(typeof(IJobQueue));
                    s.AddSingleton(queue);
                }
                if (teardownFactory is not null)
                {
                    s.RemoveAll(typeof(IAccountTeardown));
                    s.AddScoped(teardownFactory);
                }
            });
        });

    private static async Task<(HttpClient Client, DemoStartResponse Guest)> StartGuestAsync(WebApplicationFactory<Program> f)
    {
        var client = f.CreateClient();
        var resp = await client.PostAsync("/api/auth/demo", null);
        resp.EnsureSuccessStatusCode();
        var body = (await resp.Content.ReadFromJsonAsync<DemoStartResponse>())!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", body.AccessToken);
        return (client, body);
    }

    // I3: the purge no longer deletes a purged guest's device row, and
    // DemoAuthEndpointsTests.CleanupAsync reads GuestDeviceId off the user
    // row to find it — which the purge already deleted. Tests that purge a
    // guest must sweep its device row themselves; harmless no-op for a
    // device already gone.
    private static async Task DeleteDeviceRowsAsync(WebApplicationFactory<Program> f, params string?[] deviceIds)
    {
        var ids = deviceIds.Where(id => id is not null).Cast<string>().Distinct().ToList();
        if (ids.Count == 0) return;
        using var scope = f.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<AppDbContext>()
            .Devices.Where(d => ids.Contains(d.Id)).ExecuteDeleteAsync();
    }

    private static RetentionSweepScheduler Sweeper(WebApplicationFactory<Program> f) =>
        f.Services.GetServices<IHostedService>().OfType<RetentionSweepScheduler>().Single();

    // I6b — a scheduler instance with an injected batch size, built fresh
    // (not the app's own hosted instance) so a boundary test can force
    // multiple batches without waiting for 200 guests.
    private static RetentionSweepScheduler Sweeper(WebApplicationFactory<Program> f, int batchSize) =>
        new(
            f.Services.GetRequiredService<IServiceScopeFactory>(),
            f.Services.GetRequiredService<IOptions<RetentionOptions>>(),
            f.Services.GetRequiredService<ILogger<RetentionSweepScheduler>>(),
            batchSize);

    // I6a (C1) — a guest whose teardown throws must not loop forever and
    // must not block the next guest. Hard 20s external timeout so a
    // regression FAILS this test instead of hanging the suite.
    [SkippableFact]
    public async Task A_Guest_Whose_Teardown_Throws_Does_Not_Block_The_Next_Guest_And_The_Pass_Returns()
    {
        await TestDb.RequireAsync(_factory);
        var q = new RecordingQueue();
        Guid failId = default, okId = default;
        string? okDeviceId = null;
        var f = Build(
            queue: q,
            teardownFactory: sp => new ThrowingTeardown(sp.GetRequiredService<AccountTeardown>(), () => failId));
        try
        {
            var (_, fail) = await StartGuestAsync(f);
            var (_, ok) = await StartGuestAsync(f);
            failId = fail.User.Id;
            okId = ok.User.Id;

            using (var scope = f.Services.CreateScope())
            {
                var seedDb = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                okDeviceId = await seedDb.Users.Where(u => u.Id == okId).Select(u => u.GuestDeviceId).SingleAsync();
                await seedDb.Users
                    .Where(u => u.Id == failId || u.Id == okId)
                    .ExecuteUpdateAsync(s => s.SetProperty(u => u.GuestExpiresAt, DateTimeOffset.UtcNow.AddHours(-1)));
            }

            var sweep = Sweeper(f).PurgeExpiredGuestsAsync(
                DateTimeOffset.UtcNow, new[] { failId, okId }, CancellationToken.None);
            var winner = await Task.WhenAny(sweep, Task.Delay(TimeSpan.FromSeconds(20)));
            Assert.True(ReferenceEquals(winner, sweep),
                "PurgeExpiredGuestsAsync did not return within 20s (infinite-loop regression).");
            Assert.Equal(1, await sweep);

            using var scope2 = f.Services.CreateScope();
            var db = scope2.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.True(await db.Users.AnyAsync(u => u.Id == failId), "the failed guest's row must survive.");
            Assert.False(await db.Users.AnyAsync(u => u.Id == okId), "the next guest must still be purged.");

            Assert.Equal(1, await db.AuditLogs.CountAsync(a => a.Action == "guest_purge" && a.Target == okId.ToString()));
            Assert.False(await db.AuditLogs.AnyAsync(a => a.Action == "guest_purge" && a.Target == failId.ToString()));
            Assert.Contains(q.SentWithArgs, m =>
                m.Task == DramatiqTasks.DeleteAccountData && (string)m.Args[0] == okId.ToString());
            Assert.DoesNotContain(q.SentWithArgs, m =>
                m.Task == DramatiqTasks.DeleteAccountData && (string)m.Args[0] == failId.ToString());
        }
        finally
        {
            await DemoAuthEndpointsTests.CleanupAsync(f, failId, okId);
            await DeleteDeviceRowsAsync(f, okDeviceId);
            f.Dispose();
        }
    }

    // I6b — more guests than fit in one batch: batch size injected (2) so
    // 5 guests force 3 batches without waiting on a real 200-guest backlog.
    [SkippableFact]
    public async Task More_Guests_Than_One_Batch_Are_All_Purged_With_Bounded_Iterations()
    {
        await TestDb.RequireAsync(_factory);
        var q = new RecordingQueue();
        var f = Build(queue: q);
        var ids = new List<Guid>();
        var deviceIds = new List<string?>();
        try
        {
            for (var i = 0; i < 5; i++)
            {
                var (_, g) = await StartGuestAsync(f);
                ids.Add(g.User.Id);
            }

            using (var scope = f.Services.CreateScope())
            {
                var seedDb = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                deviceIds = await seedDb.Users.Where(u => ids.Contains(u.Id)).Select(u => u.GuestDeviceId).ToListAsync();
                await seedDb.Users
                    .Where(u => ids.Contains(u.Id))
                    .ExecuteUpdateAsync(s => s.SetProperty(u => u.GuestExpiresAt, DateTimeOffset.UtcNow.AddHours(-1)));
            }

            var sweep = Sweeper(f, batchSize: 2).PurgeExpiredGuestsAsync(DateTimeOffset.UtcNow, ids, CancellationToken.None);
            var winner = await Task.WhenAny(sweep, Task.Delay(TimeSpan.FromSeconds(20)));
            Assert.True(ReferenceEquals(winner, sweep), "PurgeExpiredGuestsAsync did not return within 20s.");
            Assert.Equal(5, await sweep);

            using var scope2 = f.Services.CreateScope();
            var db = scope2.ServiceProvider.GetRequiredService<AppDbContext>();
            foreach (var id in ids)
                Assert.False(await db.Users.AnyAsync(u => u.Id == id));
        }
        finally
        {
            await DemoAuthEndpointsTests.CleanupAsync(f, ids.ToArray());
            await DeleteDeviceRowsAsync(f, deviceIds.ToArray());
            f.Dispose();
        }
    }

    [SkippableFact]
    public async Task The_Sweep_Purges_Expired_Guests_And_Keeps_Live_Ones()
    {
        await TestDb.RequireAsync(_factory);
        var q = new RecordingQueue();
        var f = Build(queue: q);
        Guid deadId = default, liveId = default;
        try
        {
            var (_, dead) = await StartGuestAsync(f);
            var (_, live) = await StartGuestAsync(f);
            deadId = dead.User.Id;
            liveId = live.User.Id;

            using (var scope = f.Services.CreateScope())
                await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users
                    .Where(u => u.Id == dead.User.Id)
                    .ExecuteUpdateAsync(s => s.SetProperty(u => u.GuestExpiresAt, DateTimeOffset.UtcNow.AddHours(-1)));

            await Sweeper(f).RunOnceAsync(CancellationToken.None);

            using var s2 = f.Services.CreateScope();
            var db = s2.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.False(await db.Users.AnyAsync(u => u.Id == dead.User.Id));
            Assert.True(await db.Users.AnyAsync(u => u.Id == live.User.Id));
            Assert.Contains(q.SentWithArgs, m =>
                m.Task == DramatiqTasks.DeleteAccountData && (string)m.Args[0] == dead.User.Id.ToString());
            Assert.DoesNotContain(q.SentWithArgs, m =>
                m.Task == DramatiqTasks.DeleteAccountData && (string)m.Args[0] == live.User.Id.ToString());
            Assert.True(await db.AuditLogs.AnyAsync(a => a.Action == "guest_purge" && a.Target == dead.User.Id.ToString()));
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, deadId, liveId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task A_Purged_Guests_Token_Stops_Working_Immediately()
    {
        await TestDb.RequireAsync(_factory);
        var f = Build();
        Guid userId = default;
        try
        {
            var (client, g) = await StartGuestAsync(f);
            userId = g.User.Id;

            using (var scope = f.Services.CreateScope())
                await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users
                    .Where(u => u.Id == g.User.Id)
                    .ExecuteUpdateAsync(s => s.SetProperty(u => u.GuestExpiresAt, DateTimeOffset.UtcNow.AddHours(-1)));

            await Sweeper(f).RunOnceAsync(CancellationToken.None);

            // Teardown evicted the tver: cache — the guest's access token,
            // still well inside its normal TTL, must die immediately.
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/songs/")).StatusCode);
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task Real_Users_Are_Never_Touched_By_The_Guest_Pass()
    {
        await TestDb.RequireAsync(_factory);
        var q = new RecordingQueue();
        var f = Build(queue: q);
        Guid userId = default;
        try
        {
            (userId, _) = await TestAuth.RegisterAsync(f.CreateClient());

            await Sweeper(f).RunOnceAsync(CancellationToken.None);

            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.True(await db.Users.AnyAsync(u => u.Id == userId));
            Assert.DoesNotContain(q.SentWithArgs, m =>
                m.Task == DramatiqTasks.DeleteAccountData && (string)m.Args[0] == userId.ToString());
        }
        finally
        {
            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await TestAuth.AllowPurgeAsync(db);
            await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
        }
    }

    // The purge predicate is a query on IsGuest ONLY — never on the email
    // suffix or on guest_expires_at alone. A real user can never satisfy
    // `IsGuest`, even if some inconsistent row happened to carry a past
    // guest_expires_at (e.g. a bug elsewhere, or a manual DB edit).
    [SkippableFact]
    public async Task A_Real_User_With_An_Inconsistent_Past_GuestExpiresAt_Is_Never_Purged()
    {
        await TestDb.RequireAsync(_factory);
        var q = new RecordingQueue();
        var f = Build(queue: q);
        Guid userId = default;
        try
        {
            (userId, _) = await TestAuth.RegisterAsync(f.CreateClient());
            using (var scope = f.Services.CreateScope())
                await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users
                    .Where(u => u.Id == userId)
                    .ExecuteUpdateAsync(s => s.SetProperty(u => u.GuestExpiresAt, DateTimeOffset.UtcNow.AddHours(-1)));

            await Sweeper(f).RunOnceAsync(CancellationToken.None);

            using var scope2 = f.Services.CreateScope();
            var db = scope2.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.True(await db.Users.AnyAsync(u => u.Id == userId));
            Assert.DoesNotContain(q.SentWithArgs, m =>
                m.Task == DramatiqTasks.DeleteAccountData && (string)m.Args[0] == userId.ToString());
        }
        finally
        {
            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await TestAuth.AllowPurgeAsync(db);
            await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
        }
    }

    // Same guard, the other inconsistent shape: a real (IsGuest=false) row
    // whose email merely LOOKS like a guest email. The predicate must never
    // key on the email suffix (GuestIdentity.IsGuestEmail) — only IsGuest.
    // Register() itself refuses this email shape (GuestIdentity guard), so
    // the row is seeded directly.
    [SkippableFact]
    public async Task A_Real_User_With_A_Guest_Looking_Email_Is_Never_Purged()
    {
        await TestDb.RequireAsync(_factory);
        var q = new RecordingQueue();
        var f = Build(queue: q);
        var userId = Guid.NewGuid();
        try
        {
            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var hasher = scope.ServiceProvider.GetRequiredService<Spectr.Bff.Auth.PasswordHasher>();
                db.Users.Add(new UserEntity
                {
                    Id = userId,
                    Email = Spectr.Bff.Auth.GuestIdentity.EmailFor(userId), // guest-looking, real row
                    HashedPassword = hasher.Hash("Whatever9!"),
                    IsGuest = false,
                    GuestExpiresAt = DateTimeOffset.UtcNow.AddHours(-1), // also inconsistent — must not matter
                });
                await db.SaveChangesAsync();
            }

            await Sweeper(f).RunOnceAsync(CancellationToken.None);

            using var scope2 = f.Services.CreateScope();
            var db2 = scope2.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.True(await db2.Users.AnyAsync(u => u.Id == userId));
            Assert.DoesNotContain(q.SentWithArgs, m =>
                m.Task == DramatiqTasks.DeleteAccountData && (string)m.Args[0] == userId.ToString());
        }
        finally
        {
            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await TestAuth.AllowPurgeAsync(db);
            await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
        }
    }

    // D5 ruling: a NULL guest_expires_at on a guest row counts as expired
    // (a stray row from a failed/partial seed must not live forever).
    [SkippableFact]
    public async Task A_Guest_With_Null_GuestExpiresAt_Is_Purged()
    {
        await TestDb.RequireAsync(_factory);
        var q = new RecordingQueue();
        var f = Build(queue: q);
        Guid userId = default;
        try
        {
            var (_, g) = await StartGuestAsync(f);
            userId = g.User.Id;
            using (var scope = f.Services.CreateScope())
                await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users
                    .Where(u => u.Id == userId)
                    .ExecuteUpdateAsync(s => s.SetProperty(u => u.GuestExpiresAt, (DateTimeOffset?)null));

            await Sweeper(f).RunOnceAsync(CancellationToken.None);

            using var scope2 = f.Services.CreateScope();
            var db = scope2.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.False(await db.Users.AnyAsync(u => u.Id == userId));
            Assert.Contains(q.SentWithArgs, m =>
                m.Task == DramatiqTasks.DeleteAccountData && (string)m.Args[0] == userId.ToString());
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    // I3 (controller ruling, fix round 1): the guest's own device row
    // (users.guest_device_id) is NEVER deleted by the purge. The same
    // spectr_device row also serves the anonymous /analyze funnel
    // (analysis_jobs.device_id has no FK to it) — deleting it would strand
    // a visitor's in-flight anon analysis and mint them a new device id.
    // Unclaimed devices are already swept elsewhere (72h retention purge);
    // the row itself is tiny.
    [SkippableFact]
    public async Task The_Guests_Device_Row_Survives_The_Purge()
    {
        await TestDb.RequireAsync(_factory);
        var q = new RecordingQueue();
        var f = Build(queue: q);
        Guid userId = default;
        string? deviceId = null;
        try
        {
            var (_, g) = await StartGuestAsync(f);
            userId = g.User.Id;

            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                deviceId = await db.Users.Where(u => u.Id == userId).Select(u => u.GuestDeviceId).SingleAsync();
                await db.Users.Where(u => u.Id == userId)
                    .ExecuteUpdateAsync(s => s.SetProperty(u => u.GuestExpiresAt, DateTimeOffset.UtcNow.AddHours(-1)));
            }

            await Sweeper(f).PurgeExpiredGuestsAsync(DateTimeOffset.UtcNow, new[] { userId }, CancellationToken.None);

            using var scope2 = f.Services.CreateScope();
            var db2 = scope2.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.False(await db2.Users.AnyAsync(u => u.Id == userId));
            Assert.NotNull(deviceId);
            Assert.True(await db2.Devices.AnyAsync(d => d.Id == deviceId));
        }
        finally
        {
            // CleanupAsync reads GuestDeviceId off the user row to know what
            // device to remove — but the purge already deleted that row, so
            // it can't reach this one. Delete it directly; it's a row only
            // this test created.
            await DemoAuthEndpointsTests.CleanupAsync(f, userId);
            if (deviceId is not null)
            {
                using var scope = f.Services.CreateScope();
                await scope.ServiceProvider.GetRequiredService<AppDbContext>()
                    .Devices.Where(d => d.Id == deviceId).ExecuteDeleteAsync();
            }
            f.Dispose();
        }
    }
}
