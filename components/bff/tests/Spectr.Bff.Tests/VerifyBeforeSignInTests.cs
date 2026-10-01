using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Endpoints;
using Spectr.Bff.Services;
using Spectr.Data;
using Xunit;

namespace Spectr.Bff.Tests;

// Verify-before-sign-in (2026-10) — permanent accounts are PENDING until the
// emailed link is clicked; the link activates AND signs in; a guest's
// sign-up is parked until verify; activation grants the sign-up bonus once.
// Every factory here turns Development's Auth:DevAutoVerify OFF so the
// production path is what runs. Shares the "DemoAuth" collection because the
// guest cases mint/count users.is_guest rows like the other demo suites.
[Collection("DemoAuth")]
public sealed class VerifyBeforeSignInTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private const string Password = "correct-horse-battery";

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

    private (WebApplicationFactory<Program> F, RecordingEmailSender Email) Build(
        bool rateLimits = false, string? creditsEnabled = null)
    {
        var email = new RecordingEmailSender();
        var f = factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Auth:DevAutoVerify", "false");
            b.UseSetting("Demo:Enabled", "true");
            b.UseSetting("Demo:SnapshotKey", "");
            b.UseSetting("RateLimits:Enabled", rateLimits ? "true" : "false");
            if (creditsEnabled is not null) b.UseSetting("Credits:Enabled", creditsEnabled);
            b.ConfigureTestServices(s =>
            {
                s.RemoveAll(typeof(IEmailSender));
                s.AddSingleton<IEmailSender>(email);
                s.RemoveAll(typeof(IJobQueue));
                s.AddSingleton<IJobQueue>(new DemoAuthEndpointsTests.RecordingJobQueue());
            });
        });
        return (f, email);
    }

    private static string NewEmail(string tag) => $"vbs-{tag}+{Guid.NewGuid():N}@spectr.test";

    private static string TokenFrom(RecordingEmailSender email, string to)
    {
        var sent = email.Sent.Last(s => s.Template == EmailTemplates.Verification && s.To == to);
        return Regex.Match(sent.Data["verifyUrl"], @"token=([A-Za-z0-9_\-]+)").Groups[1].Value;
    }

    private static int VerificationCount(RecordingEmailSender email, string to)
        => email.Sent.Count(s => s.Template == EmailTemplates.Verification && s.To == to);

    private static bool SetsRefreshCookie(HttpResponseMessage resp)
        => resp.Headers.TryGetValues("Set-Cookie", out var cookies)
           && cookies.Any(c => c.StartsWith(RefreshTokenService.CookieName + "=", StringComparison.Ordinal)
                               && !c.StartsWith(RefreshTokenService.CookieName + "=;", StringComparison.Ordinal));

    private static async Task<Guid> UserIdAsync(WebApplicationFactory<Program> f, string email)
    {
        using var scope = f.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users
            .Where(u => u.Email == email).Select(u => u.Id).SingleAsync();
    }

    private static async Task<int> BonusRowsAsync(WebApplicationFactory<Program> f, Guid userId)
    {
        using var scope = f.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<AppDbContext>().CreditLedger
            .CountAsync(e => e.UserId == userId && e.Reason == CreditLedgerService.ReasonSignupBonus);
    }

    private static async Task<int> ExpectedBonusAsync(WebApplicationFactory<Program> f)
    {
        using var scope = f.Services.CreateScope();
        var flags = await scope.ServiceProvider.GetRequiredService<EntitlementService>().GetFlagsAsync(default);
        return flags.TryGetValue(CreditLedgerService.SignupBonusFlag, out var v) && int.TryParse(v, out var n) && n > 0 ? n : 0;
    }

    // Pins the bonus size for one factory by overriding its 60 s flag cache
    // (the SAME map SignupBonusAmountAsync reads) — never mutates the shared
    // feature_flags row other suites can see.
    private static async Task PinBonusAsync(WebApplicationFactory<Program> f, string value)
    {
        using var scope = f.Services.CreateScope();
        var flags = new Dictionary<string, string>(
            await scope.ServiceProvider.GetRequiredService<EntitlementService>().GetFlagsAsync(default))
        { [CreditLedgerService.SignupBonusFlag] = value };
        f.Services.GetRequiredService<IMemoryCache>().Set("feature_flags_global", flags, TimeSpan.FromMinutes(5));
    }

    internal static async Task CleanupAsync(WebApplicationFactory<Program> f, params Guid[] ids)
    {
        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await TestAuth.AllowPurgeAsync(db);
            foreach (var id in ids.Where(i => i != default))
            {
                await db.CreditLedger.Where(e => e.UserId == id).ExecuteDeleteAsync();
                await db.AuthTokens.Where(t => t.UserId == id).ExecuteDeleteAsync();
            }
        }
        await DemoAuthEndpointsTests.CleanupAsync(f, ids);
    }

    private static async Task<HttpResponseMessage> RegisterAsync(HttpClient c, string email, string password = Password)
        => await c.PostAsJsonAsync("/api/auth/register", new { email, password });

    // ── register ───────────────────────────────────────────────────────────

    [SkippableFact]
    public async Task Register_Creates_A_Pending_Account_With_No_Session()
    {
        await TestDb.RequireAsync(factory);
        var (f, mail) = Build();
        Guid id = default;
        try
        {
            var email = NewEmail("reg");
            var resp = await RegisterAsync(f.CreateClient(), email);
            Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);
            var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
            Assert.True(body.GetProperty("verificationRequired").GetBoolean());
            Assert.Equal(email, body.GetProperty("email").GetString());
            Assert.False(body.TryGetProperty("accessToken", out _));
            Assert.False(SetsRefreshCookie(resp));

            id = await UserIdAsync(f, email);
            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Null((await db.Users.AsNoTracking().SingleAsync(u => u.Id == id)).EmailVerifiedAt);
            Assert.Equal(0, await db.RefreshTokens.CountAsync(t => t.UserId == id));
            Assert.Equal(1, VerificationCount(mail, email));
            // Copy promises the link signs them in.
            var (_, html) = EmailTemplates.Render(EmailTemplates.Verification,
                new Dictionary<string, string> { ["verifyUrl"] = "https://x.test/verify-email?token=t", ["expiresHours"] = "24" });
            Assert.Contains("signs you in", html);
        }
        finally { await CleanupAsync(f, id); f.Dispose(); }
    }

    [SkippableFact]
    public async Task Re_Registering_A_Pending_Address_Resends_And_The_Latest_Password_Wins()
    {
        await TestDb.RequireAsync(factory);
        var (f, mail) = Build();
        Guid id = default;
        try
        {
            var client = f.CreateClient();
            var email = NewEmail("rereg");
            Assert.Equal(HttpStatusCode.Accepted, (await RegisterAsync(client, email, "FirstPassword1!")).StatusCode);
            id = await UserIdAsync(f, email);
            var firstToken = TokenFrom(mail, email);

            var again = await RegisterAsync(client, email, "SecondPassword2!");
            Assert.Equal(HttpStatusCode.Accepted, again.StatusCode);   // same shape as a new address
            Assert.Equal(2, VerificationCount(mail, email));
            Assert.Equal(id, await UserIdAsync(f, email));             // same row, no duplicate

            // The earlier link died with the resend.
            Assert.Equal(HttpStatusCode.BadRequest,
                (await client.PostAsJsonAsync("/api/auth/verify-email", new { token = firstToken })).StatusCode);
            var verify = await client.PostAsJsonAsync("/api/auth/verify-email", new { token = TokenFrom(mail, email) });
            Assert.Equal(HttpStatusCode.OK, verify.StatusCode);

            Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/auth/login",
                new { email, password = "FirstPassword1!" })).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/auth/login",
                new { email, password = "SecondPassword2!" })).StatusCode);

            // A VERIFIED address keeps the existing "already registered" answer.
            var taken = await RegisterAsync(client, email, "ThirdPassword3!");
            await TestContract.AssertEnvelopeAsync(taken, HttpStatusCode.Conflict, "email_taken");
        }
        finally { await CleanupAsync(f, id); f.Dispose(); }
    }

    // ── login / refresh ────────────────────────────────────────────────────

    [SkippableFact]
    public async Task Login_Refuses_An_Unverified_Account_With_Its_Own_Code()
    {
        await TestDb.RequireAsync(factory);
        var (f, _) = Build();
        Guid id = default;
        try
        {
            var client = f.CreateClient();
            var email = NewEmail("login");
            await RegisterAsync(client, email);
            id = await UserIdAsync(f, email);

            var resp = await client.PostAsJsonAsync("/api/auth/login", new { email, password = Password });
            await TestContract.AssertEnvelopeAsync(resp, HttpStatusCode.Forbidden, "email_unverified");
            Assert.False(SetsRefreshCookie(resp));

            // No oracle beyond today's: a wrong password is still the plain 401.
            var wrong = await client.PostAsJsonAsync("/api/auth/login", new { email, password = "WrongPassword9!" });
            await TestContract.AssertEnvelopeAsync(wrong, HttpStatusCode.Unauthorized, "invalid_credentials");
        }
        finally { await CleanupAsync(f, id); f.Dispose(); }
    }

    [SkippableFact]
    public async Task A_Pre_Gate_Refresh_Cookie_Of_An_Unverified_Account_Is_Refused()
    {
        await TestDb.RequireAsync(factory);
        // Base (Development) factory: DevAutoVerify ON — registration signs
        // in, standing in for an account created before the gate shipped.
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        var email = NewEmail("refresh");
        var reg = await RegisterAsync(client, email);
        Assert.Equal(HttpStatusCode.OK, reg.StatusCode);
        var cookie = reg.Headers.GetValues("Set-Cookie")
            .First(c => c.StartsWith(RefreshTokenService.CookieName + "=", StringComparison.Ordinal)).Split(';')[0];
        var id = await UserIdAsync(factory, email);
        try
        {
            using (var scope = factory.Services.CreateScope())
                await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.Where(u => u.Id == id)
                    .ExecuteUpdateAsync(s => s.SetProperty(u => u.EmailVerifiedAt, (DateTimeOffset?)null));

            var req = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
            req.Headers.Add("Cookie", cookie);
            await TestContract.AssertEnvelopeAsync(await client.SendAsync(req), HttpStatusCode.Forbidden, "email_unverified");
        }
        finally { await CleanupAsync(factory, id); }
    }

    // ── verify ─────────────────────────────────────────────────────────────

    [SkippableFact]
    public async Task The_Verify_Link_Activates_Signs_In_And_Grants_The_Bonus_Once()
    {
        await TestDb.RequireAsync(factory);
        var (f, mail) = Build();
        Guid id = default;
        try
        {
            var client = f.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
            var email = NewEmail("verify");
            await RegisterAsync(client, email);
            id = await UserIdAsync(f, email);
            var expectedBonus = await ExpectedBonusAsync(f);

            var resp = await client.PostAsJsonAsync("/api/auth/verify-email", new { token = TokenFrom(mail, email) });
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            Assert.True(SetsRefreshCookie(resp));
            var body = (await resp.Content.ReadFromJsonAsync<VerifyEmailResponse>())!;
            Assert.Equal(id, body.User.Id);
            Assert.False(body.Converted);

            var me = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
            me.Headers.Authorization = new("Bearer", body.AccessToken);
            Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(me)).StatusCode);

            Assert.Equal(expectedBonus > 0 ? 1 : 0, await BonusRowsAsync(f, id));
            if (expectedBonus > 0)
            {
                using var scope = f.Services.CreateScope();
                var row = await scope.ServiceProvider.GetRequiredService<AppDbContext>().CreditLedger
                    .SingleAsync(e => e.UserId == id && e.Reason == CreditLedgerService.ReasonSignupBonus);
                Assert.Equal(expectedBonus, row.Amount);
            }

            // Single-use link.
            var replay = await client.PostAsJsonAsync("/api/auth/verify-email", new { token = TokenFrom(mail, email) });
            await TestContract.AssertEnvelopeAsync(replay, HttpStatusCode.BadRequest, "invalid_token");

            // A second live link for the now-verified account still signs in
            // but never grants twice.
            string second;
            using (var scope = f.Services.CreateScope())
                second = await scope.ServiceProvider.GetRequiredService<AuthTokenService>()
                    .IssueAsync(id, AuthTokenService.PurposeVerifyEmail, AuthTokenService.VerifyEmailTtl);
            Assert.Equal(HttpStatusCode.OK,
                (await client.PostAsJsonAsync("/api/auth/verify-email", new { token = second })).StatusCode);
            Assert.Equal(expectedBonus > 0 ? 1 : 0, await BonusRowsAsync(f, id));
        }
        finally { await CleanupAsync(f, id); f.Dispose(); }
    }

    [SkippableFact]
    public async Task A_Bonus_Flag_Of_Zero_Grants_Nothing()
    {
        await TestDb.RequireAsync(factory);
        var (f, mail) = Build();
        Guid id = default;
        try
        {
            await PinBonusAsync(f, "0");
            var client = f.CreateClient();
            var email = NewEmail("nobonus");
            await RegisterAsync(client, email);
            id = await UserIdAsync(f, email);
            Assert.Equal(HttpStatusCode.OK,
                (await client.PostAsJsonAsync("/api/auth/verify-email", new { token = TokenFrom(mail, email) })).StatusCode);
            Assert.Equal(0, await BonusRowsAsync(f, id));
        }
        finally { await CleanupAsync(f, id); f.Dispose(); }
    }

    [SkippableFact]
    public async Task The_Bonus_Is_Granted_Even_With_Credits_Switched_Off_And_Nothing_Breaks()
    {
        await TestDb.RequireAsync(factory);
        var (f, mail) = Build(creditsEnabled: "false");
        Guid id = default;
        try
        {
            await PinBonusAsync(f, "500");
            var client = f.CreateClient();
            var email = NewEmail("credoff");
            await RegisterAsync(client, email);
            id = await UserIdAsync(f, email);
            var verify = await client.PostAsJsonAsync("/api/auth/verify-email", new { token = TokenFrom(mail, email) });
            Assert.Equal(HttpStatusCode.OK, verify.StatusCode);
            Assert.Equal(1, await BonusRowsAsync(f, id));

            // Entitlements still resolve (kill switch → premium), unaffected by the row.
            var token = (await verify.Content.ReadFromJsonAsync<VerifyEmailResponse>())!.AccessToken;
            var ent = new HttpRequestMessage(HttpMethod.Get, "/api/me/entitlements");
            ent.Headers.Authorization = new("Bearer", token);
            Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(ent)).StatusCode);

            // Public plans never advertise a bonus while credits are off.
            var plans = await (await client.GetAsync("/api/billing/plans")).Content.ReadFromJsonAsync<JsonElement>();
            Assert.False(plans.TryGetProperty("signupBonusCredits", out var sb) && sb.ValueKind == JsonValueKind.Number);
        }
        finally { await CleanupAsync(f, id); f.Dispose(); }
    }

    [SkippableFact]
    public async Task Public_Plans_Advertise_The_Flag_Amount_When_Credits_Are_On()
    {
        await TestDb.RequireAsync(factory);
        var (f, _) = Build(creditsEnabled: "true");
        try
        {
            await PinBonusAsync(f, "750");
            var plans = await (await f.CreateClient().GetAsync("/api/billing/plans")).Content.ReadFromJsonAsync<JsonElement>();
            Assert.True(plans.GetProperty("creditsEnabled").GetBoolean());
            Assert.Equal(750, plans.GetProperty("signupBonusCredits").GetInt32());

            await PinBonusAsync(f, "0");
            plans = await (await f.CreateClient().GetAsync("/api/billing/plans")).Content.ReadFromJsonAsync<JsonElement>();
            Assert.False(plans.TryGetProperty("signupBonusCredits", out var sb) && sb.ValueKind == JsonValueKind.Number);
        }
        finally { f.Dispose(); }
    }

    // ── resend ─────────────────────────────────────────────────────────────

    private static async Task WaitForAsync(Func<bool> condition)
    {
        for (var i = 0; i < 50 && !condition(); i++) await Task.Delay(100);
    }

    [SkippableFact]
    public async Task Anonymous_Resend_Is_Generic_And_Only_Mails_Pending_Accounts()
    {
        await TestDb.RequireAsync(factory);
        var (f, mail) = Build();
        Guid pendingId = default, verifiedId = default;
        try
        {
            var client = f.CreateClient();
            var pending = NewEmail("rs-pending");
            var verified = NewEmail("rs-verified");
            var ghost = NewEmail("rs-ghost");
            await RegisterAsync(client, pending);
            await RegisterAsync(client, verified);
            pendingId = await UserIdAsync(f, pending);
            verifiedId = await UserIdAsync(f, verified);
            await client.PostAsJsonAsync("/api/auth/verify-email", new { token = TokenFrom(mail, verified) });

            foreach (var address in new[] { ghost, verified, pending, "not-an-email" })
            {
                var resp = await client.PostAsJsonAsync("/api/auth/verify-email/resend", new { email = address });
                Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);
                Assert.Equal("", await resp.Content.ReadAsStringAsync());   // identical, empty
            }

            await WaitForAsync(() => VerificationCount(mail, pending) >= 2);
            await Task.Delay(300);
            Assert.Equal(2, VerificationCount(mail, pending));   // register + resend
            Assert.Equal(1, VerificationCount(mail, verified));  // register only
            Assert.Equal(0, VerificationCount(mail, ghost));
        }
        finally { await CleanupAsync(f, pendingId, verifiedId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task Anonymous_Resend_Is_Rate_Limited_Per_Address_Without_Changing_The_Response()
    {
        await TestDb.RequireAsync(factory);
        TestDb.Require(TestDb.RedisUp(factory), "Redis");
        var (f, mail) = Build(rateLimits: true);
        Guid id = default;
        try
        {
            // The ip arm is keyed "unknown" under TestServer — start clean.
            var redis = f.Services.GetRequiredService<StackExchange.Redis.IConnectionMultiplexer>().GetDatabase();
            foreach (var action in new[] { "auth_verify_resend", "auth_verify_resend_daily", "auth_register" })
                await redis.KeyDeleteAsync($"ratelimit:{action}:ip:unknown");

            var client = f.CreateClient();
            var email = NewEmail("rs-limit");
            await RegisterAsync(client, email);                       // send #1 (counts against the arm)
            id = await UserIdAsync(f, email);
            for (var i = 0; i < 5; i++)
            {
                var resp = await client.PostAsJsonAsync("/api/auth/verify-email/resend", new { email });
                Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);  // never a 429 oracle
            }
            await WaitForAsync(() => VerificationCount(mail, email) >= AuthEndpoints.VerifyResendPer15Min);
            await Task.Delay(500);
            Assert.Equal(AuthEndpoints.VerifyResendPer15Min, VerificationCount(mail, email));
        }
        finally
        {
            var redis = f.Services.GetRequiredService<StackExchange.Redis.IConnectionMultiplexer>().GetDatabase();
            foreach (var action in new[] { "auth_verify_resend", "auth_verify_resend_daily", "auth_register" })
                await redis.KeyDeleteAsync($"ratelimit:{action}:ip:unknown");
            await CleanupAsync(f, id); f.Dispose();
        }
    }

    // ── guest sign-up ──────────────────────────────────────────────────────

    private static async Task<(HttpClient Client, DemoStartResponse Demo)> StartGuestAsync(WebApplicationFactory<Program> f)
    {
        var client = f.CreateClient();
        var resp = await client.PostAsync("/api/auth/demo", null);
        resp.EnsureSuccessStatusCode();
        var body = (await resp.Content.ReadFromJsonAsync<DemoStartResponse>())!;
        client.DefaultRequestHeaders.Authorization = new("Bearer", body.AccessToken);
        return (client, body);
    }

    [SkippableFact]
    public async Task A_Guest_Sign_Up_Stays_A_Guest_Until_Verify_Then_Converts_Signed_In_With_Work_Kept()
    {
        await TestDb.RequireAsync(factory);
        var (f, mail) = Build();
        Guid id = default;
        try
        {
            var (client, demo) = await StartGuestAsync(f);
            id = demo.User.Id;
            var email = NewEmail("guest");

            var resp = await client.PostAsJsonAsync("/api/auth/guest/convert", new { email, password = Password });
            Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);
            var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
            Assert.True(body.GetProperty("verificationRequired").GetBoolean());
            Assert.False(body.TryGetProperty("accessToken", out _));
            Assert.False(SetsRefreshCookie(resp));

            using (var scope = f.Services.CreateScope())
            {
                var u = await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.AsNoTracking().SingleAsync(x => x.Id == id);
                Assert.True(u.IsGuest);
                Assert.Equal(email, u.PendingEmail);
                Assert.NotNull(u.PendingPasswordHash);
                Assert.NotEqual(email, u.Email);
            }
            // The guest session keeps working …
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/me/guest")).StatusCode);
            // … and the pending address can't be signed into.
            var login = await f.CreateClient().PostAsJsonAsync("/api/auth/login", new { email, password = Password });
            await TestContract.AssertEnvelopeAsync(login, HttpStatusCode.Unauthorized, "invalid_credentials");

            // The anonymous resend reaches a pending guest sign-up too.
            await f.CreateClient().PostAsJsonAsync("/api/auth/verify-email/resend", new { email });
            await WaitForAsync(() => VerificationCount(mail, email) >= 2);
            Assert.Equal(2, VerificationCount(mail, email));

            var expectedBonus = await ExpectedBonusAsync(f);
            var verify = await f.CreateClient().PostAsJsonAsync("/api/auth/verify-email", new { token = TokenFrom(mail, email) });
            Assert.Equal(HttpStatusCode.OK, verify.StatusCode);
            Assert.True(SetsRefreshCookie(verify));
            var signedIn = (await verify.Content.ReadFromJsonAsync<VerifyEmailResponse>())!;
            Assert.True(signedIn.Converted);
            Assert.Equal(id, signedIn.User.Id);         // SAME row
            Assert.False(signedIn.User.IsGuest);
            Assert.Equal(email, signedIn.User.Email);

            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var u = await db.Users.AsNoTracking().SingleAsync(x => x.Id == id);
                Assert.False(u.IsGuest); Assert.Null(u.GuestExpiresAt);
                Assert.NotNull(u.EmailVerifiedAt);
                Assert.Null(u.PendingEmail); Assert.Null(u.PendingPasswordHash);
                Assert.True(await db.Songs.AnyAsync(s => s.UserId == id && s.Id == demo.Demo.SongId)); // work kept
                Assert.Equal(1, await db.AuditLogs.CountAsync(a => a.Target == id.ToString() && a.Action == "guest_converted"));
            }
            Assert.Equal(expectedBonus > 0 ? 1 : 0, await BonusRowsAsync(f, id));

            // The old guest token is dead; the account now signs in normally.
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/auth/me")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await f.CreateClient().PostAsJsonAsync("/api/auth/login",
                new { email, password = Password })).StatusCode);
        }
        finally { await CleanupAsync(f, id); f.Dispose(); }
    }

    [SkippableFact]
    public async Task A_Guest_Whose_Sandbox_Expired_Before_Verify_Is_Not_Converted()
    {
        await TestDb.RequireAsync(factory);
        var (f, mail) = Build();
        Guid id = default;
        try
        {
            var (client, demo) = await StartGuestAsync(f);
            id = demo.User.Id;
            var email = NewEmail("guest-late");
            Assert.Equal(HttpStatusCode.Accepted, (await client.PostAsJsonAsync("/api/auth/guest/convert",
                new { email, password = Password })).StatusCode);
            using (var scope = f.Services.CreateScope())
                await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.Where(u => u.Id == id)
                    .ExecuteUpdateAsync(s => s.SetProperty(u => u.GuestExpiresAt, DateTimeOffset.UtcNow.AddMinutes(-1)));

            var verify = await f.CreateClient().PostAsJsonAsync("/api/auth/verify-email", new { token = TokenFrom(mail, email) });
            await TestContract.AssertEnvelopeAsync(verify, HttpStatusCode.Gone, "guest_expired");
            using var check = f.Services.CreateScope();
            Assert.True((await check.ServiceProvider.GetRequiredService<AppDbContext>().Users.AsNoTracking()
                .SingleAsync(u => u.Id == id)).IsGuest);
            Assert.Equal(0, await BonusRowsAsync(f, id));
        }
        finally { await CleanupAsync(f, id); f.Dispose(); }
    }
}
