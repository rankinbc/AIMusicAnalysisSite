using System.Net;
using System.Net.Http.Json;
using System.Net.Http.Headers;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Spectr.Bff.Tests;

public sealed class CompareNotesTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;
    private sealed record NoteDto(string Body);

    [SkippableFact]
    public async Task Notes_upsert_read_and_pair_is_order_independent()
    {
        await TestDb.RequireAsync(_factory);
        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var (_, a, b) = await TestSeed.SongWithTwoVersionsAsync(_factory, userId);

        var put = await client.PutAsJsonAsync($"/api/compare/notes?versionA={a}&versionB={b}",
            new { body = "fuller low end, vox still harsh" });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        // Reading with the pair REVERSED returns the same note (normalized pair).
        var got = await client.GetFromJsonAsync<NoteDto>($"/api/compare/notes?versionA={b}&versionB={a}");
        Assert.Equal("fuller low end, vox still harsh", got!.Body);

        // Upsert reversed → still one row, updated.
        await client.PutAsJsonAsync($"/api/compare/notes?versionA={b}&versionB={a}", new { body = "better" });
        got = await client.GetFromJsonAsync<NoteDto>($"/api/compare/notes?versionA={a}&versionB={b}");
        Assert.Equal("better", got!.Body);

        var del = await client.DeleteAsync($"/api/compare/notes?versionA={a}&versionB={b}");
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);
        got = await client.GetFromJsonAsync<NoteDto>($"/api/compare/notes?versionA={a}&versionB={b}");
        Assert.Equal("", got!.Body);
    }
}
