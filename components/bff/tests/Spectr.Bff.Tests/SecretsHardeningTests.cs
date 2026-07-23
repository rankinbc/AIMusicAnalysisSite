using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using System.Net;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 4.1 (NFR6) — signing keys have no fallback defaults: a non-Development
// boot without them refuses to start; short keys refuse everywhere; and the
// register/login/refresh/logout flows regress green under the new key policy.
public sealed class SecretsHardeningTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    // Isolates boot tests from ambient Jwt__Key/Anon__SigningKey env vars on
    // the host machine — a developer's exported key must not flip refusal
    // tests green/red.
    private WebApplicationFactory<Program> BootFactory(
        string environment, params (string Key, string? Value)[] settings)
        => _factory.WithWebHostBuilder(b =>
        {
            b.UseEnvironment(environment);
            b.ConfigureAppConfiguration((_, cfg) =>
                cfg.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Jwt:Key"] = null,
                    ["Anon:SigningKey"] = null,
                }));
            foreach (var (k, v) in settings)
                b.UseSetting(k, v);
        });

    private static void AssertBootRefusal(WebApplicationFactory<Program> f, string messageFragment)
    {
        var ex = Assert.ThrowsAny<Exception>(() => f.CreateClient());
        Assert.Contains(ExceptionChain(ex), e => e is InvalidOperationException);
        Assert.Contains(messageFragment, Flatten(ex));
    }

    [SkippableFact]
    public void Production_Boot_Without_Jwt_Key_Refuses_To_Start()
    {
        // Production does not load appsettings.Development.json, so no signing
        // keys exist unless env/user-secrets supply them (AC1).
        using var f = BootFactory("Production");
        AssertBootRefusal(f, "Jwt:Key");
    }

    [SkippableTheory]
    [InlineData("Production")]
    [InlineData("Development")]
    public void Short_Signing_Key_Refuses_To_Start_In_Any_Environment(string environment)
    {
        using var f = BootFactory(environment, ("Jwt:Key", "too-short"));
        AssertBootRefusal(f, "32 bytes");
    }

    [SkippableFact]
    public void Production_Boot_With_Valid_Keys_Also_Validates_Anon_Key()
    {
        using var f = BootFactory("Production", ("Jwt:Key", new string('k', 48)));
        AssertBootRefusal(f, "Anon:SigningKey");
    }

    [SkippableFact]
    public void Committed_Dev_Keys_Are_Rejected_Outside_Development()
    {
        // env=Development-on-a-prod-host bypass: the publicly-committed dev
        // keys must never sign tokens outside Development.
        using var f = BootFactory("Production",
            ("Jwt:Key", "spectr-dev-only-signing-key-not-for-production-use"));
        AssertBootRefusal(f, "PUBLICLY-COMMITTED");
    }

    [SkippableFact]
    public void Identical_Jwt_And_Anon_Keys_Are_Rejected()
    {
        var key = new string('k', 48);
        using var f = BootFactory("Production", ("Jwt:Key", key), ("Anon:SigningKey", key));
        AssertBootRefusal(f, "must DIFFER");
    }

    // HandleCookies=false: the default handler's cookie container would
    // override our manual Cookie headers and make replay tests prove nothing.
    private HttpClient CookielessClient() => _factory.CreateClient(
        new WebApplicationFactoryClientOptions { HandleCookies = false });

    [SkippableFact]
    public async Task Refresh_Rotates_And_Old_Cookie_Is_Rejected()
    {
        await TestDb.RequireAsync(_factory);

        var client = CookielessClient();
        var email = $"sec+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email, password = "CorrectHorse9!" });
        reg.EnsureSuccessStatusCode();
        var regBody = await reg.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        var userId = regBody.GetProperty("user").GetProperty("id").GetGuid();
        var firstCookie = ExtractRefreshCookie(reg);
        Assert.NotNull(firstCookie);

        // Rotate: old cookie yields a fresh access token + a NEW cookie.
        var refresh1 = await SendRefresh(client, firstCookie!);
        Assert.Equal(HttpStatusCode.OK, refresh1.StatusCode);
        var body = await refresh1.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.False(string.IsNullOrEmpty(body.GetProperty("accessToken").GetString()));
        var secondCookie = ExtractRefreshCookie(refresh1);
        Assert.NotNull(secondCookie);
        Assert.NotEqual(firstCookie, secondCookie);

        // Audit wave 1 (E2.1): a rotation-revoked cookie gets a 60 s grace
        // window (concurrent-tab refresh). The hardening property is now:
        // a replay can mint an ACCESS token but never a NEW refresh cookie…
        var replayInGrace = await SendRefresh(client, firstCookie!);
        Assert.Equal(HttpStatusCode.OK, replayInGrace.StatusCode);
        Assert.Null(ExtractRefreshCookie(replayInGrace));

        // …and once the grace window has passed, the replay is dead for good.
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Spectr.Data.AppDbContext>();
            await db.RefreshTokens
                .Where(t => t.UserId == userId && t.RevokedAt != null)
                .ExecuteUpdateAsync(s => s.SetProperty(
                    t => t.RevokedAt, DateTimeOffset.UtcNow.AddMinutes(-2)));
        }
        var replayAfterGrace = await SendRefresh(client, firstCookie!);
        Assert.Equal(HttpStatusCode.Unauthorized, replayAfterGrace.StatusCode);

        // The rotated cookie still works.
        var refresh2 = await SendRefresh(client, secondCookie!);
        Assert.Equal(HttpStatusCode.OK, refresh2.StatusCode);
    }

    [SkippableFact]
    public async Task Logout_Revokes_The_Refresh_Token()
    {
        await TestDb.RequireAsync(_factory);

        var client = CookielessClient();
        var email = $"sec+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email, password = "CorrectHorse9!" });
        reg.EnsureSuccessStatusCode();
        var regBody = await reg.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        var access = regBody.GetProperty("accessToken").GetString();
        var cookie = ExtractRefreshCookie(reg)!;

        var logout = new HttpRequestMessage(HttpMethod.Post, "/api/auth/logout");
        logout.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", access);
        logout.Headers.Add("Cookie", $"{cookie.Split('=')[0]}={cookie.Split('=', 2)[1]}");
        var logoutResp = await client.SendAsync(logout);
        Assert.Equal(HttpStatusCode.NoContent, logoutResp.StatusCode);

        // The revoked cookie must no longer refresh.
        var after = await SendRefresh(client, cookie);
        Assert.Equal(HttpStatusCode.Unauthorized, after.StatusCode);
    }

    private static async Task<HttpResponseMessage> SendRefresh(HttpClient client, string cookiePair)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
        req.Headers.Add("Cookie", cookiePair);
        return await client.SendAsync(req);
    }

    // Returns "name=value" for the refresh cookie, or null. Exact cookie
    // name (RefreshTokenService.CookieName) — not a substring guess.
    private static string? ExtractRefreshCookie(HttpResponseMessage resp)
    {
        if (!resp.Headers.TryGetValues("Set-Cookie", out var cookies)) return null;
        var name = Regex.Escape(Spectr.Bff.Auth.RefreshTokenService.CookieName);
        foreach (var c in cookies)
        {
            var m = Regex.Match(c, $@"^({name})=([^;]+)");
            if (m.Success && m.Groups[2].Value.Length > 8) return $"{m.Groups[1].Value}={m.Groups[2].Value}";
        }
        return null;
    }

    private static List<Exception> ExceptionChain(Exception ex)
    {
        var chain = new List<Exception>();
        var queue = new Queue<Exception>([ex]);
        while (queue.TryDequeue(out var e))
        {
            chain.Add(e);
            if (e is AggregateException agg)
                foreach (var i in agg.InnerExceptions) queue.Enqueue(i);
            else if (e.InnerException is not null)
                queue.Enqueue(e.InnerException);
        }
        return chain;
    }

    private static string Flatten(Exception ex)
        => string.Join(" | ", ExceptionChain(ex).Select(e => e.Message));
}
