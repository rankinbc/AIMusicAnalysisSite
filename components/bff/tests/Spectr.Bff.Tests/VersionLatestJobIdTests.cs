using System.Net.Http.Json;
using System.Net.Http.Headers;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.Mvc.Testing;
using Spectr.Data;
using Spectr.Data.Entities;
using Spectr.Bff.DTOs;
using Xunit;

namespace Spectr.Bff.Tests;

// Spec D3: the Listen page resolves the PLAYING version's report through
// GET /api/versions/{id}. A song-level "latest analysis" is the wrong answer
// for any song with more than one analyzed version, so this endpoint must
// answer per-version and must never leak a sibling's job id.
public sealed class VersionLatestJobIdTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private static Analysis Row(Guid userId, Guid songId, Guid versionId, Guid jobId, int hoursAgo) =>
        new()
        {
            Id = Guid.NewGuid(),
            JobId = jobId,
            UserId = userId,
            SongId = songId,
            VersionId = versionId,
            FinalJson = "{}",
            CreatedAt = DateTimeOffset.UtcNow.AddHours(-hoursAgo),
        };

    [SkippableFact]
    public async Task Each_version_reports_its_own_latest_job_never_a_siblings()
    {
        await TestDb.RequireAsync(_factory);
        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        var (songId, versionAId, versionBId) =
            await TestSeed.SongWithTwoVersionsAsync(_factory, userId);

        var jobA = Guid.NewGuid();
        var jobB = Guid.NewGuid();
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Analyses.Add(Row(userId, songId, versionAId, jobA, hoursAgo: 4));
            db.Analyses.Add(Row(userId, songId, versionBId, jobB, hoursAgo: 0));
            await db.SaveChangesAsync();
        }

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var a = await client.GetFromJsonAsync<VersionDto>($"/api/versions/{versionAId}");
        var b = await client.GetFromJsonAsync<VersionDto>($"/api/versions/{versionBId}");

        Assert.NotNull(a);
        Assert.NotNull(b);
        // jobB is the song's newest analysis — version A must still say jobA.
        Assert.Equal(jobA, a!.LatestJobId);
        Assert.Equal(jobB, b!.LatestJobId);
    }

    [SkippableFact]
    public async Task Newest_analysis_for_the_version_wins()
    {
        await TestDb.RequireAsync(_factory);
        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        var (songId, versionId) = await TestSeed.SongWithVersionAsync(_factory, userId);

        var older = Guid.NewGuid();
        var newer = Guid.NewGuid();
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Analyses.Add(Row(userId, songId, versionId, older, hoursAgo: 9));
            db.Analyses.Add(Row(userId, songId, versionId, newer, hoursAgo: 1));
            await db.SaveChangesAsync();
        }

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var v = await client.GetFromJsonAsync<VersionDto>($"/api/versions/{versionId}");

        Assert.NotNull(v);
        Assert.Equal(newer, v!.LatestJobId);
    }

    [SkippableFact]
    public async Task Version_with_no_analysis_reports_null()
    {
        await TestDb.RequireAsync(_factory);
        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        var (_, versionId) = await TestSeed.SongWithVersionAsync(_factory, userId);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var v = await client.GetFromJsonAsync<VersionDto>($"/api/versions/{versionId}");

        Assert.NotNull(v);
        Assert.Null(v!.LatestJobId);
    }

    // The lookup filters on `a.UserId == userId` as well as the version id.
    // Nothing covered that predicate: an analyses row carrying ANOTHER user's
    // UserId but this VersionId must not surface, or the Listen board would
    // fetch a foreign report for a version the caller does own.
    [SkippableFact]
    public async Task Another_users_analysis_of_the_same_version_never_surfaces()
    {
        await TestDb.RequireAsync(_factory);
        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        var (songId, versionId) = await TestSeed.SongWithVersionAsync(_factory, userId);

        var otherClient = _factory.CreateClient();
        var (otherUserId, _) = await TestAuth.RegisterAsync(otherClient);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Analyses.Add(Row(otherUserId, songId, versionId, Guid.NewGuid(), hoursAgo: 1));
            await db.SaveChangesAsync();
        }

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var v = await client.GetFromJsonAsync<VersionDto>($"/api/versions/{versionId}");

        Assert.NotNull(v);
        Assert.Null(v!.LatestJobId);
    }
}
