using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.Services;
using Spectr.Data;
using System.Net;
using System.Net.Http.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 10.6 (FR47/J6) — the layered-abuse simulation: scripted
// registrations, disposable-domain throttling, and the cross-account
// per-IP dispatch ceiling. WebApplicationFactory clients all share one
// "IP", which is exactly the same-machine scripting threat model.
public sealed class AbuseContainmentTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private static bool RedisUp(WebApplicationFactory<Program> f)
    {
        try
        {
            using var scope = f.Services.CreateScope();
            return scope.ServiceProvider
                .GetRequiredService<StackExchange.Redis.IConnectionMultiplexer>().IsConnected;
        }
        catch { return false; }
    }

    [Fact]
    public async Task Disposable_Detection_Covers_Builtin_And_Flag_Extension()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        using var scope = _factory.Services.CreateScope();
        var svc = scope.ServiceProvider.GetRequiredService<DisposableEmailService>();
        Assert.True(await svc.IsDisposableAsync("x@mailinator.com"));
        Assert.True(await svc.IsDisposableAsync("x@YOPMAIL.com")); // case-insensitive
        Assert.False(await svc.IsDisposableAsync("x@gmail.com"));
        Assert.False(await svc.IsDisposableAsync("not-an-email"));
    }

    [Fact]
    public async Task J6_Scripted_Registration_Burst_Is_Contained()
    {
        if (!await TestDb.Reachable(_factory)) { return; }
        if (!RedisUp(_factory)) { return; } // limiter layer needs Redis

        using var f = _factory.WithWebHostBuilder(b =>
            b.UseSetting("RateLimits:Enabled", "true"));
        var client = f.CreateClient();

        // Normal-domain burst: the 5/min/IP register arm throttles at 6.
        var salt = Guid.NewGuid().ToString("N")[..8];
        var results = new List<HttpStatusCode>();
        for (var i = 0; i < 7; i++)
        {
            var resp = await client.PostAsJsonAsync("/api/auth/register",
                new { email = $"j6-{salt}-{i}@example.com", password = "Password123!" });
            results.Add(resp.StatusCode);
        }
        // Containment proof: the burst hits 429. (No OK-count assertion —
        // the register arm's Redis key is shared with parallel-running
        // rate-limit tests; how MANY got through before the wall is timing.)
        Assert.Contains(HttpStatusCode.TooManyRequests, results);
    }

    [Fact]
    public async Task Disposable_Domain_Registrations_Hit_The_Tighter_Arm()
    {
        if (!await TestDb.Reachable(_factory)) { return; }
        if (!RedisUp(_factory)) { return; }

        using var f = _factory.WithWebHostBuilder(b =>
            b.UseSetting("RateLimits:Enabled", "true"));
        var client = f.CreateClient();

        // disposable_register_per_hour_ip defaults to 2/h — the third
        // disposable registration dies even though the general 5/min arm
        // still has headroom.
        var salt = Guid.NewGuid().ToString("N")[..8];
        var codes = new List<HttpStatusCode>();
        for (var i = 0; i < 3; i++)
        {
            var resp = await client.PostAsJsonAsync("/api/auth/register",
                new { email = $"j6d-{salt}-{i}@mailinator.com", password = "Password123!" });
            codes.Add(resp.StatusCode);
        }
        Assert.Equal(HttpStatusCode.TooManyRequests, codes[^1]);
    }

    [Fact]
    public async Task Disposable_Free_Account_Cap_Is_Reduced_At_Dispatch()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        // RateLimits stay OFF (dev default) — this test isolates the
        // disposable CAP layer from the limiter layers.
        var client = _factory.CreateClient();
        var salt = Guid.NewGuid().ToString("N")[..8];
        var email = $"cap-{salt}@mailinator.com";
        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email, password = "Password123!" });
        reg.EnsureSuccessStatusCode();
        var auth = await reg.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        var token = auth.GetProperty("accessToken").GetString();
        var userId = auth.GetProperty("user").GetProperty("id").GetGuid();
        client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var (songId, versionId) = await TestSeed.SongWithVersionAsync(_factory, userId);
        try
        {
            // Mark verified + burn ONE analysis usage event (disposable cap = 1).
            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                await db.Users.Where(u => u.Id == userId).ExecuteUpdateAsync(
                    s => s.SetProperty(u => u.EmailVerifiedAt, DateTimeOffset.UtcNow));
                db.UsageEvents.Add(new Spectr.Data.Entities.UsageEvent
                {
                    Id = Guid.NewGuid(),
                    UserId = userId,
                    EventType = "analysis",
                    BillingPeriod = DateTimeOffset.UtcNow.ToString("yyyy-MM"),
                    OccurredAt = DateTimeOffset.UtcNow,
                });
                await db.SaveChangesAsync();
            }

            // The NORMAL free cap (3) still has room; the disposable cap (1)
            // does not — dispatch refuses.
            var resp = await client.PostAsync($"/api/versions/{versionId}/analyze", null);
            Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
            Assert.Contains("entitlement_exhausted", await resp.Content.ReadAsStringAsync());
        }
        finally
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.UsageEvents.Where(e => e.UserId == userId).ExecuteDeleteAsync();
            await db.SongVersions.Where(v => v.SongId == songId).ExecuteDeleteAsync();
            await db.Songs.Where(s => s.Id == songId).ExecuteDeleteAsync();
            await db.RefreshTokens.Where(t => t.UserId == userId).ExecuteDeleteAsync();
            await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
        }
    }

    [Fact]
    public async Task CrossAccount_PerIp_Dispatch_Ceiling_Contains_N_Accounts()
    {
        if (!await TestDb.Reachable(_factory)) { return; }
        if (!RedisUp(_factory)) { return; }

        // Ceiling of 2/h for the test; RateLimits ON only for this factory.
        using var f = _factory.WithWebHostBuilder(b =>
            b.UseSetting("RateLimits:Enabled", "true"));

        // The dispatch arm's window is ONE HOUR — leftover entries from a
        // prior test run (same IP, same action) would 429 dispatch #1.
        // Clear this action's keys up front.
        using (var scope0 = f.Services.CreateScope())
        {
            var mux = scope0.ServiceProvider
                .GetRequiredService<StackExchange.Redis.IConnectionMultiplexer>();
            var server = mux.GetServer(mux.GetEndPoints()[0]);
            var rdb = mux.GetDatabase();
            await foreach (var key in server.KeysAsync(pattern: "ratelimit:analysis_dispatch:*"))
            {
                await rdb.KeyDeleteAsync(key);
            }
        }
        var cleanupUsers = new List<Guid>();
        var cleanupSongs = new List<Guid>();
        string? flagPrevious = null;
        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var flag = await db.FeatureFlags.FirstOrDefaultAsync(x => x.Name == "dispatch_per_ip_hourly");
            flagPrevious = flag?.Value;
            if (flag is null)
                db.FeatureFlags.Add(new Spectr.Data.Entities.FeatureFlag
                { Name = "dispatch_per_ip_hourly", Value = "2" });
            else flag.Value = "2";
            await db.SaveChangesAsync();
        }

        try
        {
            // Three DIFFERENT verified accounts, one "IP" (the test host):
            // dispatches 1+2 pass, 3 dies on the shared per-IP arm even
            // though every account is under its own per-account cap.
            var refused = false;
            for (var i = 0; i < 3; i++)
            {
                // Register on the BASE factory (limits off) so this test's
                // registrations never race the shared register-arm keys;
                // dispatch through f (limits on) is the layer under test.
                var (userId, token) = await TestAuth.RegisterAsync(_factory.CreateClient());
                var client = f.CreateClient();
                cleanupUsers.Add(userId);
                client.DefaultRequestHeaders.Authorization =
                    new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
                using (var scope = f.Services.CreateScope())
                {
                    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                    await db.Users.Where(u => u.Id == userId).ExecuteUpdateAsync(
                        s => s.SetProperty(u => u.EmailVerifiedAt, DateTimeOffset.UtcNow));
                }
                var (songId, versionId) = await TestSeed.SongWithVersionAsync(f, userId);
                cleanupSongs.Add(songId);

                var resp = await client.PostAsync($"/api/versions/{versionId}/analyze", null);
                if (i < 2)
                {
                    Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);
                }
                else if (resp.StatusCode == HttpStatusCode.TooManyRequests)
                {
                    refused = true;
                    Assert.Contains("rate_limited", await resp.Content.ReadAsStringAsync());
                }
            }
            Assert.True(refused, "third same-IP dispatch should hit the cross-account ceiling");
        }
        finally
        {
            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var flag = await db.FeatureFlags.FirstOrDefaultAsync(x => x.Name == "dispatch_per_ip_hourly");
            if (flag is not null)
            {
                if (flagPrevious is null) db.FeatureFlags.Remove(flag);
                else flag.Value = flagPrevious;
                await db.SaveChangesAsync();
            }
            foreach (var uid in cleanupUsers)
            {
                await db.AnalysisJobs.Where(j => j.UserId == uid).ExecuteDeleteAsync();
                await db.UsageEvents.Where(e => e.UserId == uid).ExecuteDeleteAsync();
            }
            foreach (var sid in cleanupSongs)
            {
                await db.SongVersions.Where(v => v.SongId == sid).ExecuteDeleteAsync();
                await db.Songs.Where(s => s.Id == sid).ExecuteDeleteAsync();
            }
            foreach (var uid in cleanupUsers)
            {
                await db.RefreshTokens.Where(t => t.UserId == uid).ExecuteDeleteAsync();
                await db.Users.Where(u => u.Id == uid).ExecuteDeleteAsync();
            }
        }
    }
}
