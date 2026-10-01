using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using System.Net;
using System.Net.Http.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 12.8 (AC1) — the demo seed: a labeled sample report; seeding is
// idempotent and never throws. Owner decision 2026-10: the demo is GUEST-only
// — registration no longer seeds it (guests get it via POST /api/auth/demo).
// These tests seed explicitly through the seeder (TestAuth.RegisterWithDemoAsync).
public sealed class DemoSeederTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    [SkippableFact]
    public async Task Register_Does_Not_Seed_A_Demo_Song()
    {
        await TestDb.RequireAsync(_factory);

        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        try
        {
            var songs = await client.GetFromJsonAsync<List<SongDto>>(
                "/api/songs/?include=versions,latest_result&include_archived=true");
            Assert.NotNull(songs);
            Assert.Empty(songs!); // a new account starts with an empty library

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.False(await db.Songs.AnyAsync(s => s.UserId == userId));
            Assert.False(await db.Analyses.AnyAsync(a => a.UserId == userId));
            Assert.False(await db.AnalysisJobs.AnyAsync(j => j.UserId == userId));
        }
        finally
        {
            await CleanupAsync(userId);
        }
    }

    [SkippableFact]
    public async Task Seeded_Demo_Is_A_Labeled_Report_With_Summary_That_Streams()
    {
        await TestDb.RequireAsync(_factory);

        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterWithDemoAsync(_factory, client);
        client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        try
        {
            var songs = await client.GetFromJsonAsync<List<SongDto>>(
                "/api/songs/?include=versions,latest_result");
            Assert.NotNull(songs);
            var demo = Assert.Single(songs!, s => s.Name == DemoSeeder.DemoSongName);
            Assert.Contains("sample", demo.Description, StringComparison.OrdinalIgnoreCase);
            Assert.NotNull(demo.LatestResult); // grade/score summary present
            Assert.False(string.IsNullOrEmpty(demo.LatestResult!.Grade));

            // The shared demo audio streams for the owner.
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var versionId = await db.SongVersions.AsNoTracking()
                .Where(v => db.Songs.Any(s => s.Id == v.SongId && s.UserId == userId))
                .Select(v => v.Id)
                .SingleAsync();
            var audio = await client.GetAsync($"/api/versions/{versionId}/audio");
            Assert.True(audio.StatusCode is HttpStatusCode.OK or HttpStatusCode.PartialContent,
                $"demo audio did not stream: {audio.StatusCode}");

            // Range support — the Listen page seeks; a 200-only stream would
            // break scrubbing on the demo just like any other version.
            using var rangeReq = new HttpRequestMessage(HttpMethod.Get,
                $"/api/versions/{versionId}/audio");
            rangeReq.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(0, 99);
            var partial = await client.SendAsync(rangeReq);
            Assert.Equal(HttpStatusCode.PartialContent, partial.StatusCode);
            Assert.Equal(100, (await partial.Content.ReadAsByteArrayAsync()).Length);
        }
        finally
        {
            await CleanupAsync(userId);
        }
    }

    [SkippableFact]
    public async Task Seeder_Is_Idempotent_Per_User()
    {
        await TestDb.RequireAsync(_factory);

        var client = _factory.CreateClient();
        var (userId, _) = await TestAuth.RegisterWithDemoAsync(_factory, client);
        try
        {
            using var scope = _factory.Services.CreateScope();
            var seeder = scope.ServiceProvider.GetRequiredService<DemoSeeder>();
            await seeder.SeedAsync(userId); // second run — must not duplicate

            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var demoCount = await db.Songs
                .CountAsync(s => s.UserId == userId && s.Name == DemoSeeder.DemoSongName);
            Assert.Equal(1, demoCount);
        }
        finally
        {
            await CleanupAsync(userId);
        }
    }

    // Task D12 — the fallback (sine-tone) seed path must run its final_json
    // through the same seed-time normalization as the snapshot path, so a
    // future bundled sample asset carrying phase 7 arrangement_status:
    // "pending" can never seed that unresolvable lie either.
    [SkippableFact]
    public async Task Fallback_Seed_Never_Carries_A_Pending_Arrangement_Status()
    {
        await TestDb.RequireAsync(_factory);

        var client = _factory.CreateClient();
        var (userId, _) = await TestAuth.RegisterWithDemoAsync(_factory, client);
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var analysis = await db.Analyses.AsNoTracking().SingleAsync(a => a.UserId == userId);
            using var doc = System.Text.Json.JsonDocument.Parse(analysis.FinalJson);
            if (doc.RootElement.TryGetProperty("phases", out var phases))
            {
                foreach (var phase in phases.EnumerateArray())
                {
                    if (!phase.TryGetProperty("phase", out var phaseNum) || phaseNum.GetInt32() != 7) continue;
                    if (!phase.TryGetProperty("data", out var data)) continue;
                    if (!data.TryGetProperty("arrangement_status", out var status)) continue;
                    Assert.NotEqual("pending", status.GetString());
                }
            }
        }
        finally
        {
            await CleanupAsync(userId);
        }
    }

    private sealed class ThrowingStorage : IFileStorage
    {
        public Task<Stream> OpenReadAsync(string key, CancellationToken ct = default) => throw new IOException("boom");
        public Task<string> WriteAsync(string key, Stream content, string contentType, CancellationToken ct = default) => throw new IOException("boom");
        public Task<bool> DeleteAsync(string key, CancellationToken ct = default) => throw new IOException("boom");
        public Task<Uri> GetPresignedReadUrlAsync(string key, TimeSpan expiry) => throw new IOException("boom");
        public Task<bool> ExistsAsync(string key, CancellationToken ct = default) => throw new IOException("boom");
        public Task<long?> GetFileSizeAsync(string key, CancellationToken ct = default) => throw new IOException("boom");
    }

    [SkippableFact]
    public async Task Seeder_Failure_Returns_Null_And_Leaves_No_Demo()
    {
        await TestDb.RequireAsync(_factory);

        using var broken = _factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll(typeof(IFileStorage));
            s.AddSingleton<IFileStorage>(new ThrowingStorage());
        }));
        var client = broken.CreateClient();
        var (userId, _) = await TestAuth.RegisterAsync(client); // asserts 200 internally
        try
        {
            using (var brokenScope = broken.Services.CreateScope())
            {
                // Never throws — a broken storage backend just yields no demo.
                var result = await brokenScope.ServiceProvider.GetRequiredService<DemoSeeder>().SeedAsync(userId);
                Assert.Null(result);
            }
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.False(await db.Songs.AnyAsync(
                s => s.UserId == userId && s.Name == DemoSeeder.DemoSongName));
        }
        finally
        {
            await CleanupAsync(userId);
        }
    }

    private async Task CleanupAsync(Guid userId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await TestAuth.AllowPurgeAsync(db);
        await db.Analyses.Where(a => a.UserId == userId).ExecuteDeleteAsync();
        await db.AnalysisJobs.Where(j => j.UserId == userId).ExecuteDeleteAsync();
        var songIds = await db.Songs.Where(s => s.UserId == userId).Select(s => s.Id).ToListAsync();
        await db.SongVersions.Where(v => songIds.Contains(v.SongId)).ExecuteDeleteAsync();
        await db.Songs.Where(s => s.UserId == userId).ExecuteDeleteAsync();
        await db.RefreshTokens.Where(t => t.UserId == userId).ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
    }
}
