using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Spectr.Bff.Tests;

// Task P9 (a) — a logged-out first visit used to log a red
// `POST /api/auth/refresh 401` in DevTools on the public landing: the boot
// silent-refresh always runs. No refresh cookie at all now answers a quiet
// 204 "no session"; a PRESENTED cookie that is invalid/revoked/expired still
// answers 401 (covered by AuthFlowTests / SecretsHardeningTests).
public sealed class RefreshNoSessionTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task Refresh_Without_A_Cookie_Is_A_Quiet_No_Session()
    {
        var client = factory.CreateClient();
        var r = await client.PostAsync("/api/auth/refresh", null);
        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        Assert.Equal(string.Empty, await r.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Refresh_With_A_Bogus_Cookie_Is_Still_Unauthorized()
    {
        var client = factory.CreateClient();
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
        req.Headers.Add("Cookie", $"{Spectr.Bff.Auth.RefreshTokenService.CookieName}=not-a-real-token");
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(req)).StatusCode);
    }
}
