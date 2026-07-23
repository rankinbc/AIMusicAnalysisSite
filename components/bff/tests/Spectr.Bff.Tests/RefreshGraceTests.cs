using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Data;
using System.Net;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using Xunit;

namespace Spectr.Bff.Tests;

// Audit remediation wave 1 (E2.1 / E2.2) — rotation grace window + anonymous logout.
// Grace rule: a token revoked BY ROTATION resolves for 60 s as long as its successor
// is alive; rows revoked by logout/reset have no successor and never get grace.
public sealed class RefreshGraceTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

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

    private async Task<(HttpClient Client, Guid UserId, string Cookie)> RegisterAsync()
    {
        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        var address = $"grace+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email = address, password = "CorrectHorse9!" });
        reg.EnsureSuccessStatusCode();
        var body = await reg.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        var userId = body.GetProperty("user").GetProperty("id").GetGuid();
        return (client, userId, ExtractRefreshCookie(reg)!);
    }

    private static async Task<HttpResponseMessage> RefreshWithAsync(HttpClient client, string cookie)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
        req.Headers.Add("Cookie", cookie);
        return await client.SendAsync(req);
    }

    [SkippableFact]
    public async Task Stale_Cookie_Within_Grace_Mints_Access_Without_Rotating()
    {
        await TestDb.RequireAsync(_factory);

        var (client, userId, cookieA) = await RegisterAsync();

        // Rotate A → B (the "other tab" winning the race).
        var first = await RefreshWithAsync(client, cookieA);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.NotNull(ExtractRefreshCookie(first));

        int RowCount()
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return db.RefreshTokens.AsNoTracking().Count(t => t.UserId == userId);
        }
        var rowsBefore = RowCount();

        // Present stale A again within grace: 200 + access token, NO new row, NO cookie re-set.
        var graced = await RefreshWithAsync(client, cookieA);
        Assert.Equal(HttpStatusCode.OK, graced.StatusCode);
        var body = await graced.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.False(string.IsNullOrEmpty(body.GetProperty("accessToken").GetString()));
        Assert.Null(ExtractRefreshCookie(graced));
        Assert.Equal(rowsBefore, RowCount());
    }

    [SkippableFact]
    public async Task Grace_Expires_After_Window()
    {
        await TestDb.RequireAsync(_factory);

        var (client, userId, cookieA) = await RegisterAsync();
        var first = await RefreshWithAsync(client, cookieA);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);

        // Age the rotation-revoked row past the 60 s window.
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.RefreshTokens
                .Where(t => t.UserId == userId && t.RevokedAt != null)
                .ExecuteUpdateAsync(s => s.SetProperty(
                    t => t.RevokedAt, DateTimeOffset.UtcNow.AddMinutes(-2)));
        }

        var stale = await RefreshWithAsync(client, cookieA);
        Assert.Equal(HttpStatusCode.Unauthorized, stale.StatusCode);
    }

    [SkippableFact]
    public async Task Logout_Revoked_Row_Gets_No_Grace_Even_Instantly()
    {
        await TestDb.RequireAsync(_factory);

        var (client, userId, cookieA) = await RegisterAsync();

        var logoutReq = new HttpRequestMessage(HttpMethod.Post, "/api/auth/logout");
        logoutReq.Headers.Add("Cookie", cookieA);
        var logout = await client.SendAsync(logoutReq);
        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);

        // Immediately after logout — no grace (no successor).
        var refresh = await RefreshWithAsync(client, cookieA);
        Assert.Equal(HttpStatusCode.Unauthorized, refresh.StatusCode);
    }

    [SkippableFact]
    public async Task Reset_Revoked_Rows_Get_No_Grace()
    {
        await TestDb.RequireAsync(_factory);

        var (client, userId, cookieA) = await RegisterAsync();

        // Mirror RevokeAllForUserAsync (password reset): revoke without successor.
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.RefreshTokens
                .Where(t => t.UserId == userId && t.RevokedAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(
                    t => t.RevokedAt, DateTimeOffset.UtcNow));
        }

        var refresh = await RefreshWithAsync(client, cookieA);
        Assert.Equal(HttpStatusCode.Unauthorized, refresh.StatusCode);
    }

    [SkippableFact]
    public async Task Logout_Without_Bearer_Still_Revokes_Cookie_Row()
    {
        await TestDb.RequireAsync(_factory);

        var (client, userId, cookieA) = await RegisterAsync();

        // E2.2 regression: expired/garbage bearer must not block server-side revocation.
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/auth/logout");
        req.Headers.Add("Cookie", cookieA);
        req.Headers.TryAddWithoutValidation("Authorization", "Bearer not-a-jwt");
        var resp = await client.SendAsync(req);
        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var revokedAt = await db.RefreshTokens.AsNoTracking()
            .Where(t => t.UserId == userId)
            .Select(t => t.RevokedAt)
            .SingleAsync();
        Assert.NotNull(revokedAt);
    }
}
