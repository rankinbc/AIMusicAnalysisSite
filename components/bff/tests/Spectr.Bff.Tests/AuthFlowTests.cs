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
    public async Task Forgot_Password_Never_Reveals_Account_Existence()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (f, email) = Build();
        var client = f.CreateClient();

        var unknown = await client.PostAsJsonAsync("/api/auth/forgot-password",
            new { email = $"ghost+{Guid.NewGuid():N}@spectr.test" });
        Assert.Equal(HttpStatusCode.NoContent, unknown.StatusCode);
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

        // Request reset — email recorded with the raw token.
        var forgot = await client.PostAsJsonAsync("/api/auth/forgot-password", new { email = address });
        Assert.Equal(HttpStatusCode.NoContent, forgot.StatusCode);
        var resetMail = email.Sent.Single(s => s.Template == EmailTemplates.Reset);
        var token = TokenFromUrl(resetMail.Data["resetUrl"]);

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
