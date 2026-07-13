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

// Story 12.8 (AC1) — first-run demo seed: a new account's library carries the
// labeled sample report immediately; seeding is idempotent and can never fail
// registration.
public sealed class DemoSeederTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    [SkippableFact]
    public async Task Register_Seeds_A_Labeled_Demo_Report_With_Summary()
    {
        await TestDb.RequireAsync(_factory);

        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
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
        var (userId, _) = await TestAuth.RegisterAsync(client);
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
    public async Task Seeder_Failure_Never_Fails_Registration()
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
