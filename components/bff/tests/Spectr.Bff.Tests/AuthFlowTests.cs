using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.Services;
using Spectr.Data;
using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 4.3 — verification + reset flows end-to-end (token captured from the
// recorded email, exactly as a user would receive it).
public sealed class AuthFlowTests(WebApplicationFactory<Program> factory)
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

    private (WebApplicationFactory<Program> Factory, RecordingEmailSender Email) Build()
    {
        var email = new RecordingEmailSender();
        var f = _factory.WithWebHostBuilder(b => b.ConfigureServices(s =>
            s.AddSingleton<IEmailSender>(email)));
        return (f, email);
    }

    private static string TokenFromUrl(string url)
        => Regex.Match(url, @"token=([A-Za-z0-9_\-]+)").Groups[1].Value;

    private static string? ExtractRefreshCookie(HttpResponseMessage resp)
    {
        if (!resp.Headers.TryGetValues("Set-Cookie", out var cookies)) return null;
        foreach (var c in cookies)
        {
            var m = Regex.Match(c, @"^(spectr_refresh)=([^;]+)");
            if (m.Success && m.Groups[2].Value.Length > 8)
                return $"{m.Groups[1].Value}={m.Groups[2].Value}";
        }
        return null;
    }

    // Dev auto-verify stamps EmailVerifiedAt at register under the base
    // (Development) factory. Tests that mean to exercise the token->stamp path
    // must strip that stamp first, or their assertions pass on the dev
    // convenience rather than the code under test.
    private static async Task UnverifyAsync(WebApplicationFactory<Program> f, string address)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Users.Where(u => u.Email == address).ExecuteUpdateAsync(
            s => s.SetProperty(u => u.EmailVerifiedAt, (DateTimeOffset?)null));
    }

    [Fact]
    public async Task Register_Sends_Verification_And_Token_Verifies_Once()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (f, email) = Build();
        var client = f.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        var address = $"vfy+{Guid.NewGuid():N}@spectr.test";

        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email = address, password = "CorrectHorse9!" });
        reg.EnsureSuccessStatusCode();

        var sent = email.Sent.Single(s => s.Template == EmailTemplates.Verification);
        Assert.Equal(address, sent.To);
        var token = TokenFromUrl(sent.Data["verifyUrl"]);
        Assert.True(token.Length >= 32);

        // Strip the dev auto-verify stamp so the assertion below proves the
        // TOKEN drove the stamp, not the register-time convenience.
        await UnverifyAsync(f, address);

        // Verify — 204, user stamped.
        var verify = await client.PostAsJsonAsync("/api/auth/verify-email", new { token });
        Assert.Equal(HttpStatusCode.NoContent, verify.StatusCode);
        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var verifiedAt = await db.Users.AsNoTracking()
                .Where(u => u.Email == address).Select(u => u.EmailVerifiedAt).SingleAsync();
            Assert.NotNull(verifiedAt);
        }

        // Single-use: the same token is dead now.
        var replay = await client.PostAsJsonAsync("/api/auth/verify-email", new { token });
        Assert.Equal(HttpStatusCode.BadRequest, replay.StatusCode);

        // Garbage token → 400, never a 500.
        var junk = await client.PostAsJsonAsync("/api/auth/verify-email", new { token = "nope" });
        Assert.Equal(HttpStatusCode.BadRequest, junk.StatusCode);
    }

    [Fact]
    public async Task Tokens_Are_Purpose_Bound()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (f, email) = Build();
        var client = f.CreateClient();
        var address = $"xp+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email = address, password = "CorrectHorse9!" });
        reg.EnsureSuccessStatusCode();

        // A VERIFY token must be worthless on the RESET endpoint.
        var verifyToken = TokenFromUrl(
            email.Sent.Single(s => s.Template == EmailTemplates.Verification).Data["verifyUrl"]);
        var cross = await client.PostAsJsonAsync("/api/auth/reset-password",
            new { token = verifyToken, newPassword = "NewPassword9!" });
        Assert.Equal(HttpStatusCode.BadRequest, cross.StatusCode);

        // Strip the dev auto-verify stamp so the 204 below reflects the token
        // actually verifying, not an already-verified no-op.
        await UnverifyAsync(f, address);

        // And it still works for its OWN purpose (the cross attempt did not consume it).
        var verify = await client.PostAsJsonAsync("/api/auth/verify-email", new { token = verifyToken });
        Assert.Equal(HttpStatusCode.NoContent, verify.StatusCode);
    }

    [Fact]
    public async Task Forgot_Password_Never_Reveals_Account_Existence()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (f, email) = Build();
        var client = f.CreateClient();

        var unknown = await client.PostAsJsonAsync("/api/auth/forgot-password",
            new { email = $"ghost+{Guid.NewGuid():N}@spectr.test" });
        Assert.Equal(HttpStatusCode.NoContent, unknown.StatusCode);
        await Task.Delay(400); // issue/send runs off-request now — give it a beat
        Assert.DoesNotContain(email.Sent, s => s.Template == EmailTemplates.Reset);

        // Malformed input: same 204 shape — no oracle.
        var malformed = await client.PostAsJsonAsync("/api/auth/forgot-password",
            new { email = "not-an-email" });
        Assert.Equal(HttpStatusCode.NoContent, malformed.StatusCode);
    }

    [Fact]
    public async Task Reset_Rotates_Password_And_Kills_All_Sessions()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (f, email) = Build();
        var client = f.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        var address = $"rst+{Guid.NewGuid():N}@spectr.test";

        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email = address, password = "OldPassword9!" });
        reg.EnsureSuccessStatusCode();
        var oldCookie = ExtractRefreshCookie(reg)!;

        // Request reset — the issue/send now runs OFF-REQUEST (timing-oracle
        // fix), so poll briefly for the recorded email.
        var forgot = await client.PostAsJsonAsync("/api/auth/forgot-password", new { email = address });
        Assert.Equal(HttpStatusCode.NoContent, forgot.StatusCode);
        (string To, string Template, IReadOnlyDictionary<string, string> Data) resetMail = default;
        for (var i = 0; i < 50; i++)
        {
            resetMail = email.Sent.FirstOrDefault(s => s.Template == EmailTemplates.Reset);
            if (resetMail.Template is not null) break;
            await Task.Delay(100);
        }
        Assert.Equal(EmailTemplates.Reset, resetMail.Template);
        var token = TokenFromUrl(resetMail.Data!["resetUrl"]);

        // Weak new password rejected without consuming the token.
        var weak = await client.PostAsJsonAsync("/api/auth/reset-password",
            new { token, newPassword = "short" });
        Assert.Equal(HttpStatusCode.BadRequest, weak.StatusCode);

        var reset = await client.PostAsJsonAsync("/api/auth/reset-password",
            new { token, newPassword = "NewPassword9!" });
        Assert.Equal(HttpStatusCode.NoContent, reset.StatusCode);

        // AC2: the pre-reset session is dead.
        var refreshReq = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
        refreshReq.Headers.Add("Cookie", oldCookie);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(refreshReq)).StatusCode);

        // Old password dead, new password lives.
        var oldLogin = await client.PostAsJsonAsync("/api/auth/login",
            new { email = address, password = "OldPassword9!" });
        Assert.Equal(HttpStatusCode.Unauthorized, oldLogin.StatusCode);
        var newLogin = await client.PostAsJsonAsync("/api/auth/login",
            new { email = address, password = "NewPassword9!" });
        Assert.Equal(HttpStatusCode.OK, newLogin.StatusCode);

        // Single-use: token replay dead.
        var replay = await client.PostAsJsonAsync("/api/auth/reset-password",
            new { token, newPassword = "AnotherPass9!" });
        Assert.Equal(HttpStatusCode.BadRequest, replay.StatusCode);
    }

    [Fact]
    public async Task Resend_Verification_Noops_When_Already_Verified()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (f, email) = Build();
        var client = f.CreateClient();
        var address = $"rsnd+{Guid.NewGuid():N}@spectr.test";

        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email = address, password = "CorrectHorse9!" });
        reg.EnsureSuccessStatusCode();
        var body = await reg.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        var access = body.GetProperty("accessToken").GetString();

        var token = TokenFromUrl(email.Sent.Single(s => s.Template == EmailTemplates.Verification).Data["verifyUrl"]);
        await client.PostAsJsonAsync("/api/auth/verify-email", new { token });

        var resend = new HttpRequestMessage(HttpMethod.Post, "/api/auth/resend-verification");
        resend.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", access);
        var resp = await client.SendAsync(resend);
        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        // No SECOND verification email — no-op when verified.
        Assert.Single(email.Sent, s => s.Template == EmailTemplates.Verification);
    }

    // ── Story 12.1 — dev verify-gate satisfiability ─────────────────────────

    [Fact]
    public async Task Register_AutoVerifies_In_Development_When_Flag_On()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        // Base factory runs env=Development + appsettings.Development.json
        // (Auth:DevAutoVerify=true) — registration must come out verified so
        // the second-analysis gate is satisfiable without email delivery.
        var (f, email) = Build();
        var client = f.CreateClient();
        var address = $"dav+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email = address, password = "CorrectHorse9!" });
        reg.EnsureSuccessStatusCode();

        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var verifiedAt = await db.Users.AsNoTracking()
            .Where(u => u.Email == address).Select(u => u.EmailVerifiedAt).SingleAsync();
        Assert.NotNull(verifiedAt);
        // The verification email still goes out (log-link + resend flows stay
        // exercised in dev).
        Assert.Single(email.Sent, s => s.Template == EmailTemplates.Verification);
    }

    [Fact]
    public async Task Register_Does_Not_AutoVerify_When_Flag_Off()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var email = new RecordingEmailSender();
        using var f = _factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Auth:DevAutoVerify", "false");
            b.ConfigureServices(s => s.AddSingleton<IEmailSender>(email));
        });
        var client = f.CreateClient();
        var address = $"davoff+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email = address, password = "CorrectHorse9!" });
        reg.EnsureSuccessStatusCode();

        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var verifiedAt = await db.Users.AsNoTracking()
            .Where(u => u.Email == address).Select(u => u.EmailVerifiedAt).SingleAsync();
        Assert.Null(verifiedAt);
    }

    [Fact]
    public async Task Register_Does_Not_AutoVerify_When_Flag_Absent()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        // Guards against a future default-ON regression (e.g. switching the
        // comparison to `!= "false"`): a blank/absent flag must read as OFF.
        // Empty string stands in for the key being absent — both are non-"true"
        // — and would auto-verify only under a default-on bug, failing here.
        var email = new RecordingEmailSender();
        using var f = _factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Auth:DevAutoVerify", "");
            b.ConfigureServices(s => s.AddSingleton<IEmailSender>(email));
        });
        var client = f.CreateClient();
        var address = $"davabs+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email = address, password = "CorrectHorse9!" });
        reg.EnsureSuccessStatusCode();

        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var verifiedAt = await db.Users.AsNoTracking()
            .Where(u => u.Email == address).Select(u => u.EmailVerifiedAt).SingleAsync();
        Assert.Null(verifiedAt);
    }

    [Fact]
    public async Task DevAutoVerify_Is_Inert_Outside_Development()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        // Guard test: even with the flag EXPLICITLY true, a non-Development
        // boot must not honor it (defense in depth, dev-login precedent).
        // Staging boot needs real-looking signing keys + FrontendOrigin
        // (appsettings.Development.json no longer loads).
        var email = new RecordingEmailSender();
        using var f = _factory.WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Staging");
            b.UseSetting("Jwt:Key", "staging-guard-test-jwt-signing-key-0123456789abcdef");
            b.UseSetting("Anon:SigningKey", "staging-guard-test-anon-signing-key-9876543210fedcba");
            b.UseSetting("App:FrontendOrigin", "https://staging.spectr.test");
            b.UseSetting("RateLimits:Enabled", "false");
            b.UseSetting("Auth:DevAutoVerify", "true");
            b.ConfigureServices(s => s.AddSingleton<IEmailSender>(email));
        });
        var client = f.CreateClient();
        var address = $"davstg+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email = address, password = "CorrectHorse9!" });
        reg.EnsureSuccessStatusCode();

        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var verifiedAt = await db.Users.AsNoTracking()
            .Where(u => u.Email == address).Select(u => u.EmailVerifiedAt).SingleAsync();
        Assert.Null(verifiedAt);
    }

    [Fact]
    public async Task DevLogin_Stamps_Verified_On_Target_Account()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (f, email) = Build();
        var client = f.CreateClient();
        var address = $"dvl+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email = address, password = "CorrectHorse9!" });
        reg.EnsureSuccessStatusCode();

        // Force the unverified state, then dev-login — it must stamp.
        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Users.Where(u => u.Email == address).ExecuteUpdateAsync(
                s => s.SetProperty(u => u.EmailVerifiedAt, (DateTimeOffset?)null));
        }

        var devLogin = await client.PostAsJsonAsync("/api/auth/dev-login", new { email = address });
        Assert.Equal(HttpStatusCode.OK, devLogin.StatusCode);

        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var verifiedAt = await db.Users.AsNoTracking()
                .Where(u => u.Email == address).Select(u => u.EmailVerifiedAt).SingleAsync();
            Assert.NotNull(verifiedAt);
        }
    }

    [Fact]
    public async Task Login_Rate_Limit_Returns_429()
    {
        if (!await TestDb.Reachable(_factory)) { return; }
        if (!await RedisReachable()) { return; }

        // Development disables auth rate limits for the suite; this test
        // opts back in to prove the 429 path.
        var email = new RecordingEmailSender();
        using var f = _factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("RateLimits:Enabled", "true");
            b.ConfigureServices(s => s.AddSingleton<IEmailSender>(email));
        });
        var client = f.CreateClient();
        // One email actor hammered: the per-email arm (10/min) must trip even
        // though attempts are legitimate-looking.
        var address = $"hammer+{Guid.NewGuid():N}@spectr.test";
        HttpStatusCode last = HttpStatusCode.OK;
        for (var i = 0; i < 12; i++)
        {
            var resp = await client.PostAsJsonAsync("/api/auth/login",
                new { email = address, password = "WrongPassword1!" });
            last = resp.StatusCode;
            if (last == HttpStatusCode.TooManyRequests) break;
        }
        Assert.Equal(HttpStatusCode.TooManyRequests, last);
    }

    private async Task<bool> RedisReachable()
    {
        try
        {
            var mux = _factory.Services.GetRequiredService<StackExchange.Redis.IConnectionMultiplexer>();
            await mux.GetDatabase().PingAsync();
            return true;
        }
        catch { return false; }
    }
}
