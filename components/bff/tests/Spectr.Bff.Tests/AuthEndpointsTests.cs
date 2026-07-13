using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.DTOs;
using Spectr.Data;
using System.Net;
using System.Net.Http.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Integration tests for the auth surface. These assume the
// docker-compose Postgres is up and the Initial migration has been applied
// to the database named in appsettings.Development.json (or to a test DB you
// point ConnectionStrings:Postgres at via environment variable when running).
//
// These tests are intentionally idempotent — each one uses a fresh, timestamped
// email so reruns don't collide.
public sealed class AuthEndpointsTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private HttpClient NewClient()
    {
        return _factory.WithWebHostBuilder(b =>
        {
            b.ConfigureServices(s =>
            {
                // No-op — kept here so future test fixtures can swap services if needed.
                _ = s;
            });
        }).CreateClient();
    }

    [SkippableFact]
    public async Task Register_Login_Roundtrip_Issues_Access_Token()
    {
        await TestDb.RequireAsync(_factory);

        var client = NewClient();
        var email = $"slice1+{Guid.NewGuid():N}@spectr.test";
        var password = "correct-horse-battery";

        var register = await client.PostAsJsonAsync("/api/auth/register",
            new { email, password });
        Assert.Equal(HttpStatusCode.OK, register.StatusCode);
        var reg = await register.Content.ReadFromJsonAsync<AuthResponse>();
        Assert.NotNull(reg);
        Assert.False(string.IsNullOrEmpty(reg!.AccessToken));
        Assert.Equal(email, reg.User.Email);
        Assert.False(string.IsNullOrEmpty(reg.User.Handle));

        // Login with the same credentials returns a fresh token.
        var login = await client.PostAsJsonAsync("/api/auth/login",
            new { email, password });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
    }

    [SkippableFact]
    public async Task Me_Requires_Bearer()
    {
        await TestDb.RequireAsync(_factory);

        var client = NewClient();
        var resp = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [SkippableFact]
    public async Task Songs_List_Requires_Auth()
    {
        await TestDb.RequireAsync(_factory);

        var client = NewClient();
        var resp = await client.GetAsync("/api/songs/");
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

}
