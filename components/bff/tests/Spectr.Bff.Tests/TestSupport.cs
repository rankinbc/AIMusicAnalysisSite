using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.DTOs;
using Spectr.Data;

namespace Spectr.Bff.Tests;

/// <summary>
/// Shared test helpers to avoid duplicating the Postgres-reachability gate and
/// the register-then-extract-token boilerplate across multiple test classes.
/// </summary>
public static class TestDb
{
    /// <summary>
    /// Returns true when the docker-compose Postgres is up and the Initial
    /// migration has been applied.  Tests that call this and get false must
    /// return early (skip) rather than fail.
    /// </summary>
    public static async Task<bool> Reachable<TProgram>(WebApplicationFactory<TProgram> factory)
        where TProgram : class
    {
        try
        {
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.Database.CanConnectAsync();
        }
        catch
        {
            return false;
        }
    }
}

public static class TestAuth
{
    /// <summary>
    /// Registers a fresh user with a unique timestamped e-mail and returns
    /// (userId, accessToken).  The register response already carries User.Id
    /// so no second round-trip to /api/auth/me is needed.
    /// </summary>
    public static async Task<(Guid UserId, string Token)> RegisterAsync(HttpClient client)
    {
        var email = $"test+{Guid.NewGuid():N}@spectr.test";
        const string password = "correct-horse-battery";

        var resp = await client.PostAsJsonAsync("/api/auth/register", new { email, password });
        resp.EnsureSuccessStatusCode();
        var auth = await resp.Content.ReadFromJsonAsync<AuthResponse>();
        if (auth is null) throw new InvalidOperationException("Register returned null body.");
        return (auth.User.Id, auth.AccessToken);
    }
}
