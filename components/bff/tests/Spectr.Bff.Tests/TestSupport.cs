using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.DTOs;
using Spectr.Data;
using Spectr.Data.Entities;
using Xunit;

namespace Spectr.Bff.Tests;

/// <summary>
/// Process-wide test baseline, applied before any WebApplicationFactory builds
/// its configuration (module initializers run at assembly load).
/// </summary>
internal static class TestProcessBaseline
{
    /// <summary>
    /// Pin the credit system ON for the whole test process. The dev/CI database
    /// seeds the `credits_enabled` feature flag to 'false' (credit system
    /// switched off at launch), which would silently flip every tier-sensitive
    /// test into premium mode. The `Credits:Enabled` config key takes
    /// precedence over the DB flag (EntitlementService.CreditsEnabled), and
    /// env vars feed host config — so this one line restores credit semantics
    /// for the suite without mutating the shared database. Kill-switch tests
    /// opt back out per-factory via UseSetting("Credits:Enabled", "false")
    /// (same pattern as RateLimits:Enabled) or by passing an explicit
    /// IConfiguration to EntitlementService.
    /// </summary>
    [System.Runtime.CompilerServices.ModuleInitializer]
    internal static void PinCreditsEnabled()
        => Environment.SetEnvironmentVariable("Credits__Enabled", "true");
}

/// <summary>
/// Shared test helpers to avoid duplicating the Postgres-reachability gate and
/// the register-then-extract-token boilerplate across multiple test classes.
/// </summary>
public static class TestDb
{
    /// <summary>
    /// Story 12.7: fail-loud gate. Callers must be [SkippableFact]/[SkippableTheory].
    /// Locally without Postgres the test reports SKIPPED (visible count) instead of
    /// silently passing with zero assertions. In CI, where the DB services are
    /// provisioned, SPECTR_REQUIRE_DB=1 turns an unreachable DB into a hard
    /// failure so a broken services block can never fake a green suite.
    /// </summary>
    public static async Task RequireAsync<TProgram>(WebApplicationFactory<TProgram> factory)
        where TProgram : class
        => Require(await Reachable(factory), "Postgres");

    /// <summary>
    /// Skip-visible gate for locally probed dependencies (Redis, etc.).
    /// Pass the probe result; callers must be [SkippableFact]/[SkippableTheory].
    /// </summary>
    public static void Require(bool reachable, string dependency)
    {
        if (reachable) return;
        var detail = LastProbeError is null ? "" : $" Last probe error: {LastProbeError}";
        if (Environment.GetEnvironmentVariable("SPECTR_REQUIRE_DB") == "1")
            Assert.Fail($"{dependency} required (SPECTR_REQUIRE_DB=1) but unreachable.{detail}");
        throw new SkipException($"{dependency} unreachable — integration test skipped.{detail}");
    }

    /// <summary>Last probe exception message, surfaced in skip/fail reasons so a
    /// remote CI failure carries its root cause (auth? port? missing migration?).</summary>
    private static string? LastProbeError;

    /// <summary>
    /// Returns true when the app host's Redis multiplexer is connected.
    /// Pair with <see cref="Require"/> for tests whose HTTP requests touch
    /// Redis (rate limiter, queue enqueue) — without it a dead Redis fails
    /// them at request time instead of skipping (story 12.7).
    /// </summary>
    public static bool RedisUp<TProgram>(WebApplicationFactory<TProgram> factory)
        where TProgram : class
    {
        try
        {
            using var scope = factory.Services.CreateScope();
            var ok = scope.ServiceProvider
                .GetRequiredService<StackExchange.Redis.IConnectionMultiplexer>().IsConnected;
            if (!ok) LastProbeError = "Redis multiplexer not connected";
            return ok;
        }
        catch (Exception ex)
        {
            LastProbeError = ex.Message;
            return false;
        }
    }

    /// <summary>
    /// Returns true when the docker-compose Postgres is up and the Initial
    /// migration has been applied. Prefer <see cref="RequireAsync{TProgram}"/> —
    /// an early return on false is invisible to the test runner (story 12.7).
    /// </summary>
    public static async Task<bool> Reachable<TProgram>(WebApplicationFactory<TProgram> factory)
        where TProgram : class
    {
        try
        {
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var ok = await db.Database.CanConnectAsync();
            if (!ok) LastProbeError = "CanConnectAsync returned false";
            return ok;
        }
        catch (Exception ex)
        {
            LastProbeError = ex.Message;
            return false;
        }
    }

    /// <summary>
    /// Redis endpoint for tests that open their OWN multiplexer (outside the app
    /// host). Honors the same `Redis__ConnectionString` env override the BFF
    /// host reads, so a machine where `localhost` → [::1] is black-holed
    /// (docs/STARTUP.md problem #2) can run the whole suite on 127.0.0.1.
    /// </summary>
    public static string RedisEndpoint(string options = "")
    {
        var endpoint = Environment.GetEnvironmentVariable("Redis__ConnectionString");
        if (string.IsNullOrWhiteSpace(endpoint)) endpoint = "localhost:6379";
        return string.IsNullOrEmpty(options) ? endpoint : $"{endpoint},{options}";
    }
}

public static class TestContract
{
    /// <summary>
    /// Story 12.7 (AC3, pairs with 12.1 AC5): the dispatch-path error CONTRACT.
    /// Every rejection must carry the AR38 envelope `{ error: { code, message } }`
    /// with a stable machine-readable code — the frontend keys off `code`,
    /// never message text. Shared so every dispatch 4xx site asserts the SAME
    /// shape (DispatchErrorContractTests, AbuseContainmentTests, …).
    /// </summary>
    public static async Task AssertEnvelopeAsync(
        HttpResponseMessage resp, System.Net.HttpStatusCode expectedStatus, string expectedCode)
    {
        Assert.Equal(expectedStatus, resp.StatusCode);
        using var doc = System.Text.Json.JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        var error = doc.RootElement.GetProperty("error");
        Assert.Equal(expectedCode, error.GetProperty("code").GetString());
        Assert.False(string.IsNullOrWhiteSpace(error.GetProperty("message").GetString()));
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

    /// <summary>
    /// Story 10.5: audit_log + credit_ledger are trigger-enforced
    /// append-only. Test cleanup legitimately purges its own rows — this
    /// arms the session-scoped escape hatch. Opens the context's connection
    /// so the SET and the subsequent deletes share one Postgres session.
    /// </summary>
    public static async Task AllowPurgeAsync(Spectr.Data.AppDbContext db)
    {
        await db.Database.OpenConnectionAsync();
        await db.Database.ExecuteSqlRawAsync("SET spectr.allow_purge = '1'");
    }

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
