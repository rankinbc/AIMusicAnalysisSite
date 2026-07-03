using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
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

    [Fact]
    public void Production_Boot_Without_Jwt_Key_Refuses_To_Start()
    {
        // Production does not load appsettings.Development.json, so no signing
        // keys exist unless env/user-secrets supply them (AC1).
        using var f = _factory.WithWebHostBuilder(b => b.UseEnvironment("Production"));
        var ex = Assert.ThrowsAny<Exception>(() => f.CreateClient());
        Assert.Contains("Jwt:Key", Flatten(ex));
    }

    [Fact]
    public void Short_Signing_Key_Refuses_To_Start_In_Any_Environment()
    {
        using var f = _factory.WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Production");
            b.UseSetting("Jwt:Key", "too-short");
        });
        var ex = Assert.ThrowsAny<Exception>(() => f.CreateClient());
        Assert.Contains("32 bytes", Flatten(ex));
    }

    [Fact]
    public void Production_Boot_With_Valid_Keys_Also_Validates_Anon_Key()
    {
        using var f = _factory.WithWebHostBuilder(b =>
        {
            b.UseEnvironment("Production");
            b.UseSetting("Jwt:Key", new string('k', 48));
            // Anon:SigningKey deliberately absent — must be the next refusal.
        });
        var ex = Assert.ThrowsAny<Exception>(() => f.CreateClient());
        Assert.Contains("Anon:SigningKey", Flatten(ex));
    }

    [Fact]
    public async Task Refresh_Rotates_And_Old_Cookie_Is_Rejected()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var client = _factory.CreateClient();
        var email = $"sec+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email, password = "CorrectHorse9!" });
        reg.EnsureSuccessStatusCode();
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

        // Replaying the CONSUMED first cookie must be rejected (rotation).
        var replay = await SendRefresh(client, firstCookie!);
        Assert.Equal(HttpStatusCode.Unauthorized, replay.StatusCode);

        // The rotated cookie still works.
        var refresh2 = await SendRefresh(client, secondCookie!);
        Assert.Equal(HttpStatusCode.OK, refresh2.StatusCode);
    }

    [Fact]
    public async Task Logout_Revokes_The_Refresh_Token()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var client = _factory.CreateClient();
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

    // Returns "name=value" for the spectr refresh cookie, or null.
    private static string? ExtractRefreshCookie(HttpResponseMessage resp)
    {
        if (!resp.Headers.TryGetValues("Set-Cookie", out var cookies)) return null;
        foreach (var c in cookies)
        {
            var m = Regex.Match(c, @"^([^=]*refresh[^=]*)=([^;]+)", RegexOptions.IgnoreCase);
            if (m.Success && m.Groups[2].Value.Length > 8) return $"{m.Groups[1].Value}={m.Groups[2].Value}";
        }
        return null;
    }

    private static string Flatten(Exception ex)
    {
        var parts = new List<string>();
        for (Exception? e = ex; e is not null; e = e.InnerException) parts.Add(e.Message);
        if (ex is AggregateException agg)
            parts.AddRange(agg.InnerExceptions.Select(i => i.Message));
        return string.Join(" | ", parts);
    }
}
