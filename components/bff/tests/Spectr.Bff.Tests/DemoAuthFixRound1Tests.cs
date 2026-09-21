using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using Xunit;

namespace Spectr.Bff.Tests;

// Task D5 fix round 1 — resume is bounded (C1), the endpoint never 500s or
// orphans a guest (I2), a stale device never flaps between two guests (I4).
// Companion to DemoAuthEndpointsTests.cs (happy-path create/resume/expiry +
// shared RecordingJobQueue/ActionAwareLimiter/ThrowingLimiter/Code/
// DeviceCookie/CleanupAsync/BuildFactory helpers) and to
// DemoAuthFixRound1GuardsTests.cs (I5/I6/I8, split out to keep this file
// under ~500 lines — reuses SeedGuestAsync/DemoPost/Build from here).
// [Collection]: shares the "DemoAuth" collection defined in
// DemoAuthEndpointsTests.cs — see that class's comment for why.
[Collection("DemoAuth")]
public sealed class DemoAuthFixRound1Tests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    // Injectable fault points for IGuestSeeder — a decorating fake around the
    // REAL DemoSeeder (I2/I4): everything not targeted falls through to real
    // seeding, so a fresh mint made in the SAME request still gets a real demo.
    private sealed class GuestSeederFaults
    {
        public bool ThrowOnAnySeed;
        public Guid? NullForUserId;
        public Guid? ThrowForUserId;
    }

    private sealed class DecoratingGuestSeeder(IGuestSeeder inner, GuestSeederFaults faults) : IGuestSeeder
    {
        public Task<DemoSeedResult?> FindAsync(Guid userId, CancellationToken ct = default) =>
            userId == faults.NullForUserId ? Task.FromResult<DemoSeedResult?>(null) : inner.FindAsync(userId, ct);

        public Task<DemoSeedResult?> SeedAsync(Guid userId, CancellationToken ct = default)
        {
            if (faults.ThrowOnAnySeed || userId == faults.ThrowForUserId)
                throw new InvalidOperationException("seed unavailable (test double)");
            return userId == faults.NullForUserId ? Task.FromResult<DemoSeedResult?>(null) : inner.SeedAsync(userId, ct);
        }
    }

    private WebApplicationFactory<Program> Build(Action<IWebHostBuilder>? extra = null) =>
        DemoAuthEndpointsTests.BuildFactory(factory, new DemoAuthEndpointsTests.RecordingJobQueue(), extra);

    // Seeds a guest row DIRECTLY (bypassing the endpoint) with a valid HMAC
    // device cookie — lets tests reach the resume branch without spending a
    // creation-limit slot. Internal: reused by DemoAuthFixRound1GuardsTests.
    internal static async Task<(Guid UserId, string Cookie)> SeedGuestAsync(
        WebApplicationFactory<Program> f, DateTimeOffset guestExpiresAt,
        DateTimeOffset? createdAt = null, string? password = null)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var cfg = scope.ServiceProvider.GetRequiredService<IConfiguration>();
        var hasher = scope.ServiceProvider.GetRequiredService<PasswordHasher>();
        var id = Guid.NewGuid();
        var deviceId = UlidGen.NewUlid();
        db.Users.Add(new User
        {
            Id = id,
            Email = GuestIdentity.EmailFor(id),
            HashedPassword = password is null ? "$2a$12$notarealhash.notarealhash.notarealha" : hasher.Hash(password),
            EmailVerifiedAt = DateTimeOffset.UtcNow,
            NotifyAnalysisComplete = false,
            DisplayName = "Guest",
            IsGuest = true,
            GuestExpiresAt = guestExpiresAt,
            GuestDeviceId = deviceId,
            CreatedAt = createdAt ?? DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
        var key = cfg["Anon:SigningKey"]!;
        return (id, $"{DeviceService.CookieName}={DeviceService.Sign(deviceId, key)}");
    }

    internal static HttpRequestMessage DemoPost(string? cookie = null)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/auth/demo");
        if (cookie is not null) req.Headers.Add("Cookie", cookie);
        return req;
    }

    // ── C1 — resume is bounded ──────────────────────────────────────────────

    [SkippableFact]
    public async Task Resume_Reuses_A_Single_Refresh_Row_Across_Repeated_Calls()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        var (userId, cookie) = await SeedGuestAsync(f, DateTimeOffset.UtcNow.AddHours(72));
        try
        {
            var client = f.CreateClient();
            for (var i = 0; i < 5; i++)
            {
                var resp = await client.SendAsync(DemoPost(cookie));
                resp.EnsureSuccessStatusCode();
                var body = await resp.Content.ReadFromJsonAsync<DemoStartResponse>();
                Assert.True(body!.Resumed);
                Assert.Equal(userId, body.User.Id);
            }
            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var rows = await db.RefreshTokens.AsNoTracking().Where(t => t.UserId == userId).CountAsync();
            Assert.Equal(1, rows);
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task A_Device_That_Exhausted_The_Creation_Limit_Can_Still_Resume()
    {
        await TestDb.RequireAsync(factory);
        var limiter = new DemoAuthEndpointsTests.ActionAwareLimiter { DenyAction = "demo_create" };
        var f = Build(b => b.UseSetting("RateLimits:Enabled", "true")
            .ConfigureTestServices(s => { s.RemoveAll(typeof(IRateLimiter)); s.AddSingleton<IRateLimiter>(limiter); }));
        var (userId, cookie) = await SeedGuestAsync(f, DateTimeOffset.UtcNow.AddHours(72));
        try
        {
            var resp = await f.CreateClient().SendAsync(DemoPost(cookie));
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode); // demo_create is denied for everyone — resume must not touch it
            var body = await resp.Content.ReadFromJsonAsync<DemoStartResponse>();
            Assert.True(body!.Resumed);
            Assert.Equal(userId, body.User.Id);
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task Resume_Rate_Limit_Denies_Then_Fails_Closed_On_A_Limiter_Exception()
    {
        await TestDb.RequireAsync(factory);
        var limiter = new DemoAuthEndpointsTests.ActionAwareLimiter { DenyAction = "demo_resume" };
        var f = Build(b => b.UseSetting("RateLimits:Enabled", "true")
            .ConfigureTestServices(s => { s.RemoveAll(typeof(IRateLimiter)); s.AddSingleton<IRateLimiter>(limiter); }));
        var (userId, cookie) = await SeedGuestAsync(f, DateTimeOffset.UtcNow.AddHours(72));
        try
        {
            var client = f.CreateClient();
            var denied = await client.SendAsync(DemoPost(cookie));
            Assert.Equal(HttpStatusCode.TooManyRequests, denied.StatusCode);
            Assert.Equal("rate_limited", await DemoAuthEndpointsTests.Code(denied));

            limiter.DenyAction = null;
            limiter.ThrowAction = "demo_resume";
            var broken = await client.SendAsync(DemoPost(cookie));
            Assert.Equal(HttpStatusCode.ServiceUnavailable, broken.StatusCode);
            Assert.Equal("demo_unavailable", await DemoAuthEndpointsTests.Code(broken));
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    // ── I8 — creation limiter DENY (not only the exception arm) ────────────

    [SkippableFact]
    public async Task Creation_Rate_Limit_Denies_With_429()
    {
        await TestDb.RequireAsync(factory);
        var limiter = new DemoAuthEndpointsTests.ActionAwareLimiter { DenyAction = "demo_create" };
        var f = Build(b => b.UseSetting("RateLimits:Enabled", "true")
            .ConfigureTestServices(s => { s.RemoveAll(typeof(IRateLimiter)); s.AddSingleton<IRateLimiter>(limiter); }));
        try
        {
            var resp = await f.CreateClient().PostAsync("/api/auth/demo", null);
            Assert.Equal(HttpStatusCode.TooManyRequests, resp.StatusCode);
            Assert.Equal("rate_limited", await DemoAuthEndpointsTests.Code(resp));
        }
        finally { f.Dispose(); }
    }

    // ── I2 — the endpoint never 500s, and never burns a cap slot on a guest
    // nobody can use ─────────────────────────────────────────────────────────

    [SkippableFact]
    public async Task Seeding_Throws_During_Creation_Returns_503_And_Leaves_No_Orphan_Guest()
    {
        await TestDb.RequireAsync(factory);
        var faults = new GuestSeederFaults { ThrowOnAnySeed = true };
        var f = Build(b => b.ConfigureTestServices(s =>
        {
            s.AddSingleton(faults);
            s.RemoveAll(typeof(IGuestSeeder));
            s.AddScoped<IGuestSeeder>(sp => new DecoratingGuestSeeder(sp.GetRequiredService<DemoSeeder>(), faults));
        }));
        List<Guid> beforeIds;
        using (var scope = f.Services.CreateScope())
            beforeIds = await scope.ServiceProvider.GetRequiredService<AppDbContext>()
                .Users.Where(u => u.IsGuest).Select(u => u.Id).ToListAsync();
        try
        {
            var resp = await f.CreateClient().PostAsync("/api/auth/demo", null);
            Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
            Assert.Equal("demo_unavailable", await DemoAuthEndpointsTests.Code(resp));

            using var scope = f.Services.CreateScope();
            var afterIds = await scope.ServiceProvider.GetRequiredService<AppDbContext>()
                .Users.Where(u => u.IsGuest).Select(u => u.Id).ToListAsync();
            Assert.Equal(beforeIds.Count, afterIds.Count); // the committed row was compensated away
        }
        finally
        {
            // Belt and suspenders: if the assertion above ever fails again, don't
            // leave a real guest row behind for a LATER test's daily-cap count.
            using var scope = f.Services.CreateScope();
            var leftover = await scope.ServiceProvider.GetRequiredService<AppDbContext>()
                .Users.Where(u => u.IsGuest && !beforeIds.Contains(u.Id)).Select(u => u.Id).ToListAsync();
            if (leftover.Count > 0) await DemoAuthEndpointsTests.CleanupAsync(f, [.. leftover]);
            f.Dispose();
        }
    }

    [SkippableFact]
    public async Task Seeding_Throws_During_Resume_Returns_503_Without_Touching_The_Existing_Guest()
    {
        await TestDb.RequireAsync(factory);
        var faults = new GuestSeederFaults();
        var f = Build(b => b.ConfigureTestServices(s =>
        {
            s.AddSingleton(faults);
            s.RemoveAll(typeof(IGuestSeeder));
            s.AddScoped<IGuestSeeder>(sp => new DecoratingGuestSeeder(sp.GetRequiredService<DemoSeeder>(), faults));
        }));
        var expires = DateTimeOffset.UtcNow.AddHours(72);
        var (userId, cookie) = await SeedGuestAsync(f, expires);
        faults.ThrowForUserId = userId; // this guest has no seeded demo yet — FindAsync (real) -> null -> SeedAsync throws
        try
        {
            var resp = await f.CreateClient().SendAsync(DemoPost(cookie));
            Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
            Assert.Equal("demo_unavailable", await DemoAuthEndpointsTests.Code(resp));

            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var still = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == userId);
            Assert.NotNull(still); // pre-existing guest was never minted THIS request — no compensation
            Assert.True(still!.GuestExpiresAt >= expires.AddSeconds(-1)); // and not expired by I4 either — this was a throw, not a null/null
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    // ── I4 — newest guest wins; a dead-end orphan is expired, not flapped ───

    [SkippableFact]
    public async Task Resume_Picks_The_Newest_Guest_When_A_Device_Has_Two()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        var deviceId = UlidGen.NewUlid();
        var older = Guid.NewGuid();
        var newer = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        string cookie;
        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Users.AddRange(
                new User { Id = older, Email = GuestIdentity.EmailFor(older), HashedPassword = "x", EmailVerifiedAt = now,
                    IsGuest = true, GuestExpiresAt = now.AddHours(72), GuestDeviceId = deviceId, CreatedAt = now.AddMinutes(-10) },
                new User { Id = newer, Email = GuestIdentity.EmailFor(newer), HashedPassword = "x", EmailVerifiedAt = now,
                    IsGuest = true, GuestExpiresAt = now.AddHours(72), GuestDeviceId = deviceId, CreatedAt = now });
            await db.SaveChangesAsync();
            var cfg = scope.ServiceProvider.GetRequiredService<IConfiguration>();
            cookie = $"{DeviceService.CookieName}={DeviceService.Sign(deviceId, cfg["Anon:SigningKey"]!)}";
        }
        try
        {
            var resp = await f.CreateClient().SendAsync(DemoPost(cookie));
            resp.EnsureSuccessStatusCode();
            var body = await resp.Content.ReadFromJsonAsync<DemoStartResponse>();
            Assert.True(body!.Resumed);
            Assert.Equal(newer, body.User.Id);
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, older, newer); f.Dispose(); }
    }

    [SkippableFact]
    public async Task An_Orphaned_Guest_With_No_Seed_Is_Expired_Before_Falling_Through_To_A_New_Sandbox()
    {
        await TestDb.RequireAsync(factory);
        var faults = new GuestSeederFaults();
        var f = Build(b => b.ConfigureTestServices(s =>
        {
            s.AddSingleton(faults);
            s.RemoveAll(typeof(IGuestSeeder));
            s.AddScoped<IGuestSeeder>(sp => new DecoratingGuestSeeder(sp.GetRequiredService<DemoSeeder>(), faults));
        }));
        var expires = DateTimeOffset.UtcNow.AddHours(72);
        var (orphanId, cookie) = await SeedGuestAsync(f, expires);
        faults.NullForUserId = orphanId; // FindAsync AND SeedAsync both null for this one id only
        Guid newId = default;
        try
        {
            var resp = await f.CreateClient().SendAsync(DemoPost(cookie));
            resp.EnsureSuccessStatusCode();
            var body = await resp.Content.ReadFromJsonAsync<DemoStartResponse>();
            Assert.False(body!.Resumed);
            Assert.NotEqual(orphanId, body.User.Id);
            newId = body.User.Id;

            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var orphan = await db.Users.AsNoTracking().SingleAsync(u => u.Id == orphanId);
            Assert.True(orphan.GuestExpiresAt <= DateTimeOffset.UtcNow);
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, orphanId, newId); f.Dispose(); }
    }
}
