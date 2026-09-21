using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using Xunit;

namespace Spectr.Bff.Tests;

// Task D5 fix round 1 (continued) — guests cannot reset a password (I5) or
// log in / get verification email (I6), plus the remaining I8 teeth (real
// daily cap, tampered cookie, expired-refresh envelope, forgot-password
// silence, demo_enabled flag fallback). Split out of DemoAuthFixRound1Tests.cs
// to keep both files under ~500 lines; reuses its SeedGuestAsync/DemoPost and
// DemoAuthEndpointsTests' RecordingJobQueue/Code/CleanupAsync/BuildFactory.
// [Collection]: shares the "DemoAuth" collection defined in
// DemoAuthEndpointsTests.cs — see that class's comment for why.
[Collection("DemoAuth")]
public sealed class DemoAuthFixRound1GuardsTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private sealed class RecordingEmailSender : IEmailSender
    {
        public readonly List<(string To, string Template)> Sent = [];
        public Task SendAsync(string toEmail, string template, IReadOnlyDictionary<string, string> data, CancellationToken ct = default)
        { Sent.Add((toEmail, template)); return Task.CompletedTask; }
    }

    private WebApplicationFactory<Program> Build(Action<IWebHostBuilder>? extra = null) =>
        DemoAuthEndpointsTests.BuildFactory(factory, new DemoAuthEndpointsTests.RecordingJobQueue(), extra);

    // ── I5 — a guest can never reset its way into a permanent account ──────

    [SkippableFact]
    public async Task A_Guest_Cannot_Reset_Its_Password()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        var (userId, _) = await DemoAuthFixRound1Tests.SeedGuestAsync(f, DateTimeOffset.UtcNow.AddHours(72));
        try
        {
            string originalHash;
            string raw;
            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                originalHash = (await db.Users.AsNoTracking().SingleAsync(u => u.Id == userId)).HashedPassword;
                var tokens = scope.ServiceProvider.GetRequiredService<AuthTokenService>();
                raw = await tokens.IssueAsync(userId, AuthTokenService.PurposeResetPassword, AuthTokenService.ResetPasswordTtl);
            }
            var resp = await f.CreateClient().PostAsJsonAsync("/api/auth/reset-password",
                new { token = raw, newPassword = "BrandNewPassword9!" });
            Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
            Assert.Equal("invalid_token", await DemoAuthEndpointsTests.Code(resp));

            using var scope2 = f.Services.CreateScope();
            var db2 = scope2.ServiceProvider.GetRequiredService<AppDbContext>();
            var after = (await db2.Users.AsNoTracking().SingleAsync(u => u.Id == userId)).HashedPassword;
            Assert.Equal(originalHash, after);
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    // ── I6 — explicit guest refusals in login + resend-verification ────────

    [SkippableFact]
    public async Task A_Guest_With_A_Matching_Password_Still_Cannot_Log_In()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        const string password = "KnownGuestPassword9!";
        var (userId, _) = await DemoAuthFixRound1Tests.SeedGuestAsync(f, DateTimeOffset.UtcNow.AddHours(72), password: password);
        try
        {
            var resp = await f.CreateClient().PostAsJsonAsync("/api/auth/login",
                new { email = GuestIdentity.EmailFor(userId), password });
            Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
            Assert.Equal("invalid_credentials", await DemoAuthEndpointsTests.Code(resp));
            Assert.False(resp.Headers.TryGetValues("Set-Cookie", out var cookies)
                && cookies.Any(c => c.StartsWith("spectr_refresh=", StringComparison.Ordinal)));
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task Resend_Verification_Never_Enqueues_For_A_Guest_Address()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        Guid userId = default;
        try
        {
            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                userId = Guid.NewGuid();
                db.Users.Add(new User
                {
                    Id = userId, Email = GuestIdentity.EmailFor(userId), HashedPassword = "x",
                    EmailVerifiedAt = null, // unverified — the only thing standing between a guest and a real send is the IsGuest guard
                    IsGuest = true, GuestExpiresAt = DateTimeOffset.UtcNow.AddHours(72), GuestDeviceId = UlidGen.NewUlid(),
                });
                await db.SaveChangesAsync();
            }
            string token;
            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var user = await db.Users.SingleAsync(u => u.Id == userId);
                token = scope.ServiceProvider.GetRequiredService<JwtTokenService>().Issue(user);
            }
            var client = f.CreateClient();
            client.DefaultRequestHeaders.Authorization = new("Bearer", token);
            var resp = await client.PostAsync("/api/auth/resend-verification", null);
            // Task D6 — resend-verification is now denied-by-default under the
            // default-deny guest guard (spec D4), which intercepts BEFORE the
            // handler's own `if (user.IsGuest) return NoContent()` no-op below
            // ever runs. The guard's 403 guest_restricted supersedes the
            // quieter 204 this test asserted pre-D6 — either way no email is
            // ever sent to a guest address, which is the property this test
            // actually protects.
            Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
            Assert.Equal("guest_restricted", await DemoAuthEndpointsTests.Code(resp));

            var queue = (DemoAuthEndpointsTests.RecordingJobQueue)f.Services.GetRequiredService<IJobQueue>();
            Assert.DoesNotContain(DramatiqTasks.SendEmail, queue.Tasks);
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    // ── I8 — real daily cap, tampered cookie, expired-refresh envelope,
    // forgot-password silence, demo_enabled flag fallback ──────────────────

    [SkippableFact]
    public async Task The_Daily_Cap_Blocks_At_Exactly_N_And_Allows_At_N_Plus_One()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        var seeded = new List<Guid>();
        Guid createdId = default;
        try
        {
            // Baseline-relative — the shared dev DB / parallel test classes can
            // carry other guest rows created in the last 24h; assert against
            // (ambient + N), never an absolute count.
            int baseline;
            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                baseline = await db.Users.CountAsync(u => u.IsGuest && u.CreatedAt > DateTimeOffset.UtcNow.AddHours(-24));
            }
            const int n = 3;
            for (var i = 0; i < n; i++)
            {
                var (id, _) = await DemoAuthFixRound1Tests.SeedGuestAsync(f, DateTimeOffset.UtcNow.AddHours(72));
                seeded.Add(id);
            }
            var atCap = await Build(b => b.UseSetting("Demo:DailyCap", (baseline + n).ToString())).CreateClient().PostAsync("/api/auth/demo", null);
            Assert.Equal(HttpStatusCode.ServiceUnavailable, atCap.StatusCode);
            Assert.Equal("demo_capacity", await DemoAuthEndpointsTests.Code(atCap));

            var underCap = await Build(b => b.UseSetting("Demo:DailyCap", (baseline + n + 1).ToString())).CreateClient().PostAsync("/api/auth/demo", null);
            Assert.Equal(HttpStatusCode.OK, underCap.StatusCode);
            createdId = (await underCap.Content.ReadFromJsonAsync<DemoStartResponse>())!.User.Id;
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, [.. seeded, createdId]); f.Dispose(); }
    }

    [SkippableFact]
    public async Task A_Tampered_Device_Cookie_Never_Resumes()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        var (existingId, cookie) = await DemoAuthFixRound1Tests.SeedGuestAsync(f, DateTimeOffset.UtcNow.AddHours(72));
        var tampered = $"{DeviceService.CookieName}={cookie[(DeviceService.CookieName.Length + 1)..]}TAMPERED";
        Guid newId = default;
        try
        {
            var resp = await f.CreateClient().SendAsync(DemoAuthFixRound1Tests.DemoPost(tampered));
            resp.EnsureSuccessStatusCode();
            var body = await resp.Content.ReadFromJsonAsync<DemoStartResponse>();
            Assert.False(body!.Resumed);
            Assert.NotEqual(existingId, body.User.Id);
            newId = body.User.Id;
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, existingId, newId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task Refresh_Of_An_Expired_Guest_Returns_401_With_The_Shared_Envelope()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        var client = f.CreateClient();
        Guid userId = default;
        try
        {
            var start = await client.PostAsync("/api/auth/demo", null);
            var g = await start.Content.ReadFromJsonAsync<DemoStartResponse>();
            userId = g!.User.Id;
            var cookie = start.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith("spectr_refresh=")).Split(';')[0];
            using (var scope = f.Services.CreateScope())
                await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.Where(u => u.Id == userId)
                    .ExecuteUpdateAsync(s => s.SetProperty(u => u.GuestExpiresAt, DateTimeOffset.UtcNow.AddMinutes(-1)));
            var req = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
            req.Headers.Add("Cookie", cookie);
            var resp = await client.SendAsync(req);
            Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
            Assert.Equal("guest_expired", await DemoAuthEndpointsTests.Code(resp));
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task Forgot_Password_For_A_Guest_Issues_No_Token_And_Sends_No_Email()
    {
        await TestDb.RequireAsync(factory);
        var email = new RecordingEmailSender();
        var f = factory.WithWebHostBuilder(b => b.UseSetting("Demo:Enabled", "true").UseSetting("Demo:SnapshotKey", "")
            .ConfigureTestServices(s => { s.RemoveAll(typeof(IJobQueue)); s.AddSingleton<IJobQueue>(new DemoAuthEndpointsTests.RecordingJobQueue());
                s.AddSingleton<IEmailSender>(email); }));
        var client = f.CreateClient();
        var g = await (await client.PostAsync("/api/auth/demo", null)).Content.ReadFromJsonAsync<DemoStartResponse>();
        var userId = g!.User.Id;
        try
        {
            var resp = await client.PostAsJsonAsync("/api/auth/forgot-password", new { email = g.User.Email });
            Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
            await Task.Delay(400); // issue/send runs off-request — give it a beat (AuthFlowTests precedent)
            Assert.DoesNotContain(email.Sent, s => s.To == g.User.Email);

            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.False(await db.AuthTokens.AsNoTracking().AnyAsync(t => t.UserId == userId));
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task Demo_Enabled_Falls_Back_To_The_Flag_When_The_Config_Key_Is_Unset()
    {
        await TestDb.RequireAsync(factory);
        // "" is treated as unset by GuestIdentity.DemoEnabled — overrides the
        // appsettings.Development.json "true" without fighting config layering.
        var fOff = factory.WithWebHostBuilder(b => b.UseSetting("Demo:Enabled", "").UseSetting("Demo:SnapshotKey", ""));
        var off = await fOff.CreateClient().PostAsync("/api/auth/demo", null);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, off.StatusCode); // baseline seed: demo_enabled='false'

        Guid userId = default;
        WebApplicationFactory<Program>? fOn = null;
        try
        {
            using (var scope = fOff.Services.CreateScope())
                await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database
                    .ExecuteSqlRawAsync("UPDATE feature_flags SET value = 'true' WHERE name = 'demo_enabled'");

            // Fresh factory — a cold 60s flag cache, so the flip above is seen immediately.
            fOn = factory.WithWebHostBuilder(b => b.UseSetting("Demo:Enabled", "").UseSetting("Demo:SnapshotKey", ""));
            var on = await fOn.CreateClient().PostAsync("/api/auth/demo", null);
            Assert.Equal(HttpStatusCode.OK, on.StatusCode);
            userId = (await on.Content.ReadFromJsonAsync<DemoStartResponse>())!.User.Id;
        }
        finally
        {
            using var scope = fOff.Services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database
                .ExecuteSqlRawAsync("UPDATE feature_flags SET value = 'false' WHERE name = 'demo_enabled'");
            await DemoAuthEndpointsTests.CleanupAsync(fOff, userId);
            fOn?.Dispose();
            fOff.Dispose();
        }
    }
}
