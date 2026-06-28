using System.Net.Http.Json;
using System.Net.Http.Headers;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.Mvc.Testing;
using Spectr.Data;
using Spectr.Data.Entities;
using Spectr.Bff.DTOs;
using Xunit;

namespace Spectr.Bff.Tests;

public sealed class SongVersionMetricsTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    [Fact]
    public async Task Song_versions_carry_latest_metrics()
    {
        if (!await TestDb.Reachable(_factory)) return;
        var client = _factory.CreateClient();

        var (userId, token) = await TestAuth.RegisterAsync(client);
        var songId = Guid.NewGuid();
        var versionId = Guid.NewGuid();

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Songs.Add(new Song { Id = songId, UserId = userId, Name = "Midnight Drive" });
            db.SongVersions.Add(new SongVersion
            {
                Id = versionId, SongId = songId, VersionNumber = 1,
                Label = "demo", IsCurrent = true, FilePath = "x.wav",
            });
            db.Analyses.Add(new Analysis
            {
                Id = Guid.NewGuid(), JobId = Guid.NewGuid(), UserId = userId,
                SongId = songId, VersionId = versionId,
                FinalJson = """
                { "overall_score": 87, "phases": [ { "phase": 1, "data": {
                  "lufs": -9.1, "loudness_range_lu": 8.4, "low_energy": 62,
                  "stereo_width": 48, "bands": { "air": 71 } } } ] }
                """,
            });
            await db.SaveChangesAsync();
        }

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var song = await client.GetFromJsonAsync<SongDto>($"/api/songs/{songId}");

        Assert.NotNull(song);
        var v = Assert.Single(song!.Versions);
        Assert.NotNull(v.LatestResult);
        Assert.Equal(87, v.LatestResult!.Score);
        Assert.Equal(-9.1, v.LatestResult.Lufs);
        Assert.Equal(8.4, v.LatestResult.DynamicRangeLu);
        Assert.Equal(71, v.LatestResult.Air);
        Assert.Equal(48, v.LatestResult.StereoWidth);
    }
}
