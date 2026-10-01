using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using Xunit;

namespace Spectr.Bff.Tests;

// Task G2 (spec G-D4) — a guest who creates an account keeps the SAME users
// row: same id, songs, analyses, coach conversation, rack presets. Shares
// the "DemoAuth" collection with the other demo-auth suites (GuestCapsTests,
// GuestPurgeTests, GuestGuardInventoryTests, DemoAuthEndpointsTests) — they
// all read/count the SHARED users.is_guest rows and must not run in
// parallel with each other.
[Collection("DemoAuth")]
public sealed class GuestConvertTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private sealed class RecordingQueue : IJobQueue
    {
        // Fix round 1 (item 1) — Args captured so a test can confirm the
        // verification email job carries the NEW address, not just that
        // some job was enqueued.
        public readonly List<(string Task, object[] Args, string Queue)> Sent = [];
        public Task EnqueueAsync(string t, object[] a, CancellationToken ct = default)
        { Sent.Add((t, a, "")); return Task.CompletedTask; }
        public Task EnqueueAsync(string t, object[] a, string q, CancellationToken ct = default)
        { Sent.Add((t, a, q)); return Task.CompletedTask; }
        public Task EnqueueDelayedAsync(string t, object[] a, string q, TimeSpan d, CancellationToken ct = default)
        { Sent.Add((t, a, q)); return Task.CompletedTask; }
    }

    // Fix round 1 (item 3) — a substitution seam, not an EF mock: the ONE
    // real call site (GuestConvertEndpoints' post-UPDATE tail) throws once,
    // so the test can prove the tail's fallback path without touching the
    // database layer. The 3-arg overload (guest-session issuance) is left
    // alone, so StartGuestAsync's own demo login is unaffected.
    private sealed class ThrowOnceRefreshTokenService(AppDbContext db, IConfiguration config)
        : RefreshTokenService(db, config)
    {
        private int _calls;
        public override Task<(string Raw, RefreshToken Row)> IssueAsync(Guid userId, CancellationToken ct = default)
        {
            if (Interlocked.Increment(ref _calls) == 1)
                throw new InvalidOperationException("simulated DB blip issuing the post-conversion session");
            return base.IssueAsync(userId, ct);
        }
    }

    // rateLimits defaults OFF, matching Development's ambient default
    // (GuestCapsTests precedent) — the tests here exercise conversion logic,
    // not the shared rate-limiter arms.
    private WebApplicationFactory<Program> Build(
        RecordingQueue? queue = null, string? devAutoVerify = null, bool throwOnceOnRefreshIssue = false) =>
        factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Demo:Enabled", "true");
            b.UseSetting("Demo:SnapshotKey", "");
            if (devAutoVerify is not null)
                b.UseSetting("Auth:DevAutoVerify", devAutoVerify);
            b.ConfigureTestServices(s =>
            {
                s.RemoveAll(typeof(IJobQueue));
                s.AddSingleton<IJobQueue>(queue ?? new RecordingQueue());
                if (throwOnceOnRefreshIssue)
                {
                    s.RemoveAll(typeof(RefreshTokenService));
                    s.AddScoped<RefreshTokenService, ThrowOnceRefreshTokenService>();
                }
            });
        });

    private static async Task<(HttpClient Client, DemoStartResponse Demo)> StartGuestAsync(WebApplicationFactory<Program> f)
    {
        var client = f.CreateClient();
        var resp = await client.PostAsync("/api/auth/demo", null);
        resp.EnsureSuccessStatusCode();
        var body = (await resp.Content.ReadFromJsonAsync<DemoStartResponse>())!;
        client.DefaultRequestHeaders.Authorization = new("Bearer", body.AccessToken);
        return (client, body);
    }

    private static async Task<(HttpClient Client, Guid UserId)> RegisterRealUserAsync(WebApplicationFactory<Program> f)
    {
        var client = f.CreateClient();
        var email = $"guestconvert+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync("/api/auth/register", new { email, password = "correct-horse-battery" });
        reg.EnsureSuccessStatusCode();
        var auth = await reg.Content.ReadFromJsonAsync<AuthResponse>();
        client.DefaultRequestHeaders.Authorization = new("Bearer", auth!.AccessToken);
        return (client, auth.User.Id);
    }

    private static object Body(string? email = null) =>
        new { email = email ?? $"convert+{Guid.NewGuid():N}@spectr.test", password = "correct-horse-battery" };

    [SkippableFact]
    public async Task A_Guest_Becomes_A_Real_Account_On_The_Same_Row_And_Keeps_Their_Songs()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        Guid userId = default;
        try
        {
            var (client, demo) = await StartGuestAsync(f);
            userId = demo.User.Id;
            var email = $"convert+{Guid.NewGuid():N}@spectr.test";
            var oldToken = client.DefaultRequestHeaders.Authorization!.Parameter!;

            var resp = await client.PostAsJsonAsync("/api/auth/guest/convert", Body(email));
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            var auth = (await resp.Content.ReadFromJsonAsync<AuthResponse>())!;
            Assert.Equal(demo.User.Id, auth.User.Id);          // SAME row
            Assert.False(auth.User.IsGuest);
            Assert.Equal(email, auth.User.Email);

            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var u = await db.Users.AsNoTracking().SingleAsync(x => x.Id == demo.User.Id);
                Assert.False(u.IsGuest); Assert.Null(u.GuestExpiresAt); Assert.Null(u.GuestDeviceId);
                // Fix round 1 (item 1) — parity with register: the base
                // factory's ambient Auth:DevAutoVerify is "true"
                // (Development), so the SAME stamping register does applies
                // to a conversion too.
                Assert.NotNull(u.EmailVerifiedAt);
                Assert.True(await db.Songs.AnyAsync(s => s.UserId == u.Id && s.Id == demo.Demo.SongId)); // work kept
                Assert.Equal(1, await db.AuditLogs.CountAsync(a => a.Target == u.Id.ToString() && a.Action == "guest_converted"));
                Assert.Equal(1, await db.RefreshTokens.CountAsync(t => t.UserId == u.Id));               // old guest row gone
            }

            // The guest token is dead (version bumped); the new one is a full account.
            var stale = f.CreateClient(); stale.DefaultRequestHeaders.Authorization = new("Bearer", oldToken);
            Assert.Equal(HttpStatusCode.Unauthorized, (await stale.GetAsync("/api/auth/me")).StatusCode);
            var fresh = f.CreateClient(); fresh.DefaultRequestHeaders.Authorization = new("Bearer", auth.AccessToken);
            var export = await fresh.GetAsync("/api/me/export");
            Assert.NotEqual(HttpStatusCode.Forbidden, export.StatusCode);   // no longer fenced

            // Normal refresh lifetime: the literal Set-Cookie Expires is far beyond the guest's 24 h.
            var setCookie = resp.Headers.GetValues("Set-Cookie").Single(h => h.StartsWith(RefreshTokenService.CookieName + "="));
            var expires = DateTimeOffset.Parse(setCookie.Split(';').Select(p => p.Trim())
                .Single(p => p.StartsWith("expires=", StringComparison.OrdinalIgnoreCase))["expires=".Length..]);
            Assert.True(expires > DateTimeOffset.UtcNow.AddDays(2));
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    // Verify-before-sign-in (2026-10) — supersedes fix round 1 (item 1)'s
    // "convert now, verify later". Outside auto-verify (dev) mode the guest
    // is NOT converted by this call: the sign-up is parked on the guest row
    // (pending_email / pending_password_hash), the verification email goes
    // to the NEW address, and the row stays a guest (session, fences and the
    // synthetic EmailVerifiedAt stamp untouched) until the emailed link is
    // clicked. The verify half is covered by VerifyBeforeSignInTests.
    [SkippableFact]
    public async Task Outside_AutoVerify_A_Guest_Sign_Up_Is_Parked_Until_The_Email_Is_Verified()
    {
        await TestDb.RequireAsync(factory);
        var queue = new RecordingQueue();
        var f = Build(queue, devAutoVerify: "false");
        Guid userId = default;
        try
        {
            var (client, demo) = await StartGuestAsync(f);
            userId = demo.User.Id;
            var email = $"convert+{Guid.NewGuid():N}@spectr.test";

            var resp = await client.PostAsJsonAsync("/api/auth/guest/convert", Body(email));
            Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);
            var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
            Assert.True(body.GetProperty("verificationRequired").GetBoolean());
            Assert.Equal(email, body.GetProperty("email").GetString());
            Assert.False(body.TryGetProperty("accessToken", out _));

            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var u = await db.Users.AsNoTracking().SingleAsync(x => x.Id == demo.User.Id);
                Assert.True(u.IsGuest);
                Assert.NotNull(u.GuestExpiresAt);
                Assert.Equal(email, u.PendingEmail);
                Assert.NotEqual(email, u.Email);
                Assert.Equal(0, await db.AuditLogs.CountAsync(a => a.Target == u.Id.ToString() && a.Action == "guest_converted"));
            }

            // The verification email went out for the NEW address.
            Assert.Contains(queue.Sent, m => m.Task == DramatiqTasks.SendEmail && (string)m.Args[0] == email);
            // The guest session is untouched.
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/me/guest")).StatusCode);
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    // Fix round 1 (item 3, RED case) — the post-UPDATE tail (refresh-row
    // delete, new refresh issue, cookie write) is NOT part of the atomic
    // UPDATE; a DB blip there must not turn an already-committed conversion
    // into a 500. ThrowOnceRefreshTokenService (a substitution seam, not an
    // EF mock) makes the ONE real IssueAsync call site throw.
    [SkippableFact]
    public async Task A_Session_Issuance_Hiccup_After_Conversion_Still_Confirms_The_Account()
    {
        await TestDb.RequireAsync(factory);
        var f = Build(throwOnceOnRefreshIssue: true);
        Guid userId = default;
        try
        {
            var (client, demo) = await StartGuestAsync(f);
            userId = demo.User.Id;

            var resp = await client.PostAsJsonAsync("/api/auth/guest/convert", Body());
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

            var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
            Assert.False(body.GetProperty("sessionIssued").GetBoolean());
            Assert.Equal("Your account is ready — please sign in with your new password.",
                body.GetProperty("message").GetString());
            // No token/user fields — this is not an authenticated session.
            Assert.False(body.TryGetProperty("accessToken", out _));
            Assert.False(body.TryGetProperty("user", out _));

            // The UPDATE already committed: the account is real regardless.
            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var u = await db.Users.AsNoTracking().SingleAsync(x => x.Id == demo.User.Id);
            Assert.False(u.IsGuest);
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task An_Email_That_Exists_Leaves_The_Guest_Untouched()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        Guid takenId = default, guestId = default;
        try
        {
            var taken = $"taken+{Guid.NewGuid():N}@spectr.test";
            var takenReg = await f.CreateClient().PostAsJsonAsync("/api/auth/register", Body(taken));
            takenReg.EnsureSuccessStatusCode();
            takenId = (await takenReg.Content.ReadFromJsonAsync<AuthResponse>())!.User.Id;
            var (client, demo) = await StartGuestAsync(f);
            guestId = demo.User.Id;
            var resp = await client.PostAsJsonAsync("/api/auth/guest/convert", Body(taken));
            Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
            using var scope = f.Services.CreateScope();
            var u = await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.AsNoTracking().SingleAsync(x => x.Id == demo.User.Id);
            Assert.True(u.IsGuest); Assert.NotNull(u.GuestExpiresAt);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/me/guest")).StatusCode); // session still works
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, takenId, guestId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task A_Real_User_Cannot_Call_It()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        Guid userId = default;
        try
        {
            var (client, uid) = await RegisterRealUserAsync(f);
            userId = uid;
            var resp = await client.PostAsJsonAsync("/api/auth/guest/convert", Body());
            Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
            Assert.Equal("not_a_guest", (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetProperty("code").GetString());
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task The_Reserved_Guest_Domain_Is_Refused()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        Guid userId = default;
        try
        {
            var (client, demo) = await StartGuestAsync(f);
            userId = demo.User.Id;
            var resp = await client.PostAsJsonAsync("/api/auth/guest/convert", Body("me@guest.spectr.invalid"));
            Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task An_Expired_Guest_Cannot_Be_Resurrected()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        Guid userId = default;
        try
        {
            var (_, demo) = await StartGuestAsync(f);
            userId = demo.User.Id;
            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Users.Where(u => u.Id == demo.User.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(u => u.GuestExpiresAt, DateTimeOffset.UtcNow.AddMinutes(-1)));
            var rows = await GuestConversion.TryConvertAsync(db, demo.User.Id, $"late+{Guid.NewGuid():N}@spectr.test",
                "hash", "late", autoVerify: false, DateTimeOffset.UtcNow, default);
            Assert.Equal(0, rows);
            Assert.True((await db.Users.AsNoTracking().SingleAsync(u => u.Id == demo.User.Id)).IsGuest);
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task The_Purge_Never_Tears_Down_A_Converted_Account()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        Guid userId = default;
        try
        {
            var (client, demo) = await StartGuestAsync(f);
            userId = demo.User.Id;
            (await client.PostAsJsonAsync("/api/auth/guest/convert", Body())).EnsureSuccessStatusCode();
            var sweeper = f.Services.GetServices<IHostedService>().OfType<RetentionSweepScheduler>().Single();
            // Simulates the race: the id was selected as an expired guest, then the owner converted.
            Assert.False(await sweeper.PurgeOneGuestAsync(demo.User.Id, DateTimeOffset.UtcNow.AddDays(30), default));
            using var scope = f.Services.CreateScope();
            Assert.True(await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.AnyAsync(u => u.Id == demo.User.Id));
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    // Auth non-negotiable: the conversion must be provably ATOMIC. Two
    // concurrent conversions of the SAME guest row (different target
    // emails, so only the row-level guard — not the email-uniqueness index
    // — can be what stops the second one) must never both succeed. Calls
    // GuestConversion.TryConvertAsync directly (two independent
    // AppDbContext instances, like two concurrent requests would each get
    // their own scoped context) rather than going through HttpClient, so
    // the assertion is about the ONE UPDATE statement itself, not
    // ASP.NET's request-pipeline serialization.
    [SkippableFact]
    public async Task Concurrent_Conversions_Of_The_Same_Guest_Convert_Exactly_Once()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        Guid userId = default;
        try
        {
            var (_, demo) = await StartGuestAsync(f);
            userId = demo.User.Id;
            var now = DateTimeOffset.UtcNow;

            using var scopeA = f.Services.CreateScope();
            using var scopeB = f.Services.CreateScope();
            var dbA = scopeA.ServiceProvider.GetRequiredService<AppDbContext>();
            var dbB = scopeB.ServiceProvider.GetRequiredService<AppDbContext>();

            var emailA = $"race-a+{Guid.NewGuid():N}@spectr.test";
            var emailB = $"race-b+{Guid.NewGuid():N}@spectr.test";

            var taskA = GuestConversion.TryConvertAsync(dbA, demo.User.Id, emailA, "hashA", "A", autoVerify: false, now, default);
            var taskB = GuestConversion.TryConvertAsync(dbB, demo.User.Id, emailB, "hashB", "B", autoVerify: false, now, default);
            var results = await Task.WhenAll(taskA, taskB);

            // Exactly one of the two racing UPDATEs matched the row (WHERE
            // is_guest = true); the other found it already converted.
            Assert.Equal(1, results.Sum());
            Assert.Contains(1, results);
            Assert.Contains(0, results);

            using var verifyScope = f.Services.CreateScope();
            var verifyDb = verifyScope.ServiceProvider.GetRequiredService<AppDbContext>();
            var final = await verifyDb.Users.AsNoTracking().SingleAsync(u => u.Id == demo.User.Id);
            Assert.False(final.IsGuest);
            // The winner's email stuck — whichever one it was, never a hybrid.
            Assert.True(final.Email == emailA || final.Email == emailB);
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }
}
