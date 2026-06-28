using System.Net;
using System.Net.Http.Json;
using System.Net.Http.Headers;
using Microsoft.AspNetCore.Mvc.Testing;
using Spectr.Bff.DTOs;
using Xunit;

namespace Spectr.Bff.Tests;

public sealed class PersonalScoreTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    [Fact]
    public async Task Rating_upsert_then_clear_roundtrips_on_song_payload()
    {
        if (!await TestDb.Reachable(_factory)) return;
        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var (songId, versionId) = await TestSeed.SongWithVersionAsync(_factory, userId);

        var put = await client.PutAsJsonAsync($"/api/versions/{versionId}/rating", new { score = 90 });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var song = await client.GetFromJsonAsync<SongDto>($"/api/songs/{songId}");
        Assert.Equal(90, song!.Versions[0].PersonalScore);

        // upsert (not duplicate)
        await client.PutAsJsonAsync($"/api/versions/{versionId}/rating", new { score = 75 });
        song = await client.GetFromJsonAsync<SongDto>($"/api/songs/{songId}");
        Assert.Equal(75, song!.Versions[0].PersonalScore);

        var del = await client.DeleteAsync($"/api/versions/{versionId}/rating");
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);
        song = await client.GetFromJsonAsync<SongDto>($"/api/songs/{songId}");
        Assert.Null(song!.Versions[0].PersonalScore);
    }

    [Fact]
    public async Task Rating_rejects_out_of_range()
    {
        if (!await TestDb.Reachable(_factory)) return;
        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var (_, versionId) = await TestSeed.SongWithVersionAsync(_factory, userId);

        var bad = await client.PutAsJsonAsync($"/api/versions/{versionId}/rating", new { score = 150 });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
    }
}
