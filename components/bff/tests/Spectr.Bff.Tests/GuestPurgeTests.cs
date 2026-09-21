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

    private WebApplicationFactory<Program> Build(IJobQueue? queue = null) =>
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

    private static RetentionSweepScheduler Sweeper(WebApplicationFactory<Program> f) =>
        f.Services.GetServices<IHostedService>().OfType<RetentionSweepScheduler>().Single();

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

    // D5 review finding: the guest's own device row (users.guest_device_id)
    // is deleted once nothing references it — never a device a real user
    // has since claimed.
    [SkippableFact]
    public async Task An_Unreferenced_Guest_Device_Row_Is_Deleted_But_A_Claimed_One_Survives()
    {
        await TestDb.RequireAsync(_factory);
        var q = new RecordingQueue();
        var f = Build(queue: q);
        Guid deadId = default, claimedGuestId = default;
        try
        {
            var (_, dead) = await StartGuestAsync(f);
            deadId = dead.User.Id;
            var (_, claimedGuest) = await StartGuestAsync(f);
            claimedGuestId = claimedGuest.User.Id;

            string? deadDeviceId, claimedDeviceId;
            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                deadDeviceId = await db.Users.Where(u => u.Id == deadId).Select(u => u.GuestDeviceId).SingleAsync();
                claimedDeviceId = await db.Users.Where(u => u.Id == claimedGuestId).Select(u => u.GuestDeviceId).SingleAsync();
                // Simulate: some real user has since claimed the second
                // guest's device (e.g. a later unrelated anon-device claim).
                await db.Devices.Where(d => d.Id == claimedDeviceId)
                    .ExecuteUpdateAsync(s => s
                        .SetProperty(d => d.ClaimedByUserId, (Guid?)Guid.NewGuid())
                        .SetProperty(d => d.ClaimedAt, DateTimeOffset.UtcNow));
                await db.Users.Where(u => u.Id == deadId || u.Id == claimedGuestId)
                    .ExecuteUpdateAsync(s => s.SetProperty(u => u.GuestExpiresAt, DateTimeOffset.UtcNow.AddHours(-1)));
            }

            await Sweeper(f).RunOnceAsync(CancellationToken.None);

            using var scope2 = f.Services.CreateScope();
            var db2 = scope2.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.False(await db2.Devices.AnyAsync(d => d.Id == deadDeviceId));
            Assert.True(await db2.Devices.AnyAsync(d => d.Id == claimedDeviceId));
        }
        finally
        {
            await DemoAuthEndpointsTests.CleanupAsync(f, deadId, claimedGuestId);
            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                // CleanupAsync only deletes a guest's OWN device when the row
                // is still is_guest-owned at cleanup time; here it was
                // claimed by a fabricated real user id, so sweep it directly.
                await db.Devices.Where(d => d.ClaimedByUserId != null
                    && !db.Users.Any(u => u.Id == d.ClaimedByUserId)).ExecuteDeleteAsync();
            }
            f.Dispose();
        }
    }
}
