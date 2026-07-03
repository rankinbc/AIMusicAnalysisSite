using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.DTOs;
using Spectr.Data;
using Spectr.Data.Entities;

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
    // Exposed for tests that must re-authenticate (e.g. account deletion).
    public const string Password = "correct-horse-battery";

    public static async Task<(Guid UserId, string Token)> RegisterAsync(HttpClient client)
    {
        var email = $"test+{Guid.NewGuid():N}@spectr.test";
        const string password = Password;

        var resp = await client.PostAsJsonAsync("/api/auth/register", new { email, password });
        resp.EnsureSuccessStatusCode();
        var auth = await resp.Content.ReadFromJsonAsync<AuthResponse>();
        if (auth is null) throw new InvalidOperationException("Register returned null body.");
        return (auth.User.Id, auth.AccessToken);
    }
}

public static class TestSeed
{
    /// <summary>
    /// Seeds a Song + one SongVersion owned by <paramref name="userId"/> via a DI
    /// scope and returns their ids.  Extracted from SongVersionMetricsTests so
    /// multiple test classes can reuse this without duplicating the insert logic.
    /// </summary>
    public static async Task<(Guid SongId, Guid VersionId)> SongWithVersionAsync<TProgram>(
        WebApplicationFactory<TProgram> factory, Guid userId)
        where TProgram : class
    {
        var songId = Guid.NewGuid();
        var versionId = Guid.NewGuid();

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Songs.Add(new Song
        {
            Id = songId,
            UserId = userId,
            Name = $"Test Track {Guid.NewGuid():N}",
        });
        db.SongVersions.Add(new SongVersion
        {
            Id = versionId,
            SongId = songId,
            VersionNumber = 1,
            Label = "v1",
            IsCurrent = true,
            FilePath = $"audio/upload/{Guid.NewGuid()}/source.wav",
        });
        await db.SaveChangesAsync();

        return (songId, versionId);
    }

    /// <summary>
    /// Seeds a Song + TWO SongVersions owned by <paramref name="userId"/>.
    /// Used by compare-notes tests that need a valid normalized pair.
    /// </summary>
    public static async Task<(Guid SongId, Guid VersionAId, Guid VersionBId)> SongWithTwoVersionsAsync<TProgram>(
        WebApplicationFactory<TProgram> factory, Guid userId)
        where TProgram : class
    {
        var songId = Guid.NewGuid();
        var versionAId = Guid.NewGuid();
        var versionBId = Guid.NewGuid();

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Songs.Add(new Song
        {
            Id = songId,
            UserId = userId,
            Name = $"Test Track {Guid.NewGuid():N}",
        });
        db.SongVersions.Add(new SongVersion
        {
            Id = versionAId,
            SongId = songId,
            VersionNumber = 1,
            Label = "v1",
            IsCurrent = false,
            FilePath = $"audio/upload/{Guid.NewGuid()}/source.wav",
        });
        db.SongVersions.Add(new SongVersion
        {
            Id = versionBId,
            SongId = songId,
            VersionNumber = 2,
            Label = "v2",
            IsCurrent = true,
            FilePath = $"audio/upload/{Guid.NewGuid()}/source.wav",
        });
        await db.SaveChangesAsync();

        return (songId, versionAId, versionBId);
    }
}
