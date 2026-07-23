using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Wave-2 (E3.2) — duplicate-song-name handling on the upload path.
// Uploading the same filename twice with no song_id used to trip
// uq_songs_user_name at SaveChanges and 500 AFTER the full transfer; now the
// auto-create branch auto-suffixes the derived name ("mix", "mix (2)", …) and
// the residual race lands as a typed 409 (covered by the catch's shape — the
// race itself is not integration-testable deterministically).
// Postgres-gated like the other integration tests; each test registers a fresh
// user so fixed filenames never collide across tests or reruns.
public sealed class DuplicateSongNameTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private (HttpClient client, RecordingJobQueue queue) NewClient()
    {
        var queue = new RecordingJobQueue();
        var client = _factory.WithWebHostBuilder(b =>
        {
            b.ConfigureServices(s =>
            {
                s.RemoveAll<IJobQueue>();
                s.AddSingleton<IJobQueue>(queue);
            });
        }).CreateClient();
        return (client, queue);
    }

    [SkippableFact]
    public async Task UploadVersion_SameFilenameTwice_AutoSuffixesSecondAndThird()
    {
        await TestDb.RequireAsync(_factory);

        var (client, _) = NewClient();
        await Authenticate(client);

        var first = await Upload(client, "mix.wav");
        var second = await Upload(client, "mix.wav");
        var third = await Upload(client, "mix.wav");

        Assert.Equal("mix", await SongName(first.SongId));
        Assert.Equal("mix (2)", await SongName(second.SongId));
        Assert.Equal("mix (3)", await SongName(third.SongId));
        // Three distinct songs — the suffix dodge must never attach to an existing song.
        Assert.Equal(3, new[] { first.SongId, second.SongId, third.SongId }.Distinct().Count());
    }

    [SkippableFact]
    public async Task UploadVersion_200CharFilenameStem_SuffixedNameStaysWithinCap()
    {
        await TestDb.RequireAsync(_factory);

        var (client, _) = NewClient();
        await Authenticate(client);

        var stem = new string('a', 200);
        var first = await Upload(client, stem + ".wav");
        var second = await Upload(client, stem + ".wav");

        Assert.Equal(stem, await SongName(first.SongId));
        var suffixed = await SongName(second.SongId);
        Assert.NotNull(suffixed);
        Assert.True(suffixed!.Length <= 200, $"suffixed name exceeds 200 chars ({suffixed.Length})");
        Assert.EndsWith(" (2)", suffixed);
        Assert.StartsWith(stem[..(200 - " (2)".Length)], suffixed);
    }

    [SkippableFact]
    public async Task UploadVersion_FilenameCollidesWithExplicitSong_AutoSuffixDodges()
    {
        await TestDb.RequireAsync(_factory);

        var (client, _) = NewClient();
        await Authenticate(client);

        // User explicitly created a song named "clash" (typed name, POST /songs).
        var create = await client.PostAsJsonAsync("/api/songs/", new { name = "clash" });
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);

        // Uploading clash.wav with NO song_id must dodge to "clash (2)", not 409.
        var upload = await Upload(client, "clash.wav");
        Assert.Equal("clash (2)", await SongName(upload.SongId));
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static async Task Authenticate(HttpClient client)
    {
        var email = $"dupname+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email, password = "correct-horse-battery" });
        reg.EnsureSuccessStatusCode();
        var auth = await reg.Content.ReadFromJsonAsync<AuthResponse>();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", auth!.AccessToken);
    }

    private static async Task<UploadResponse> Upload(HttpClient client, string fileName)
    {
        using var form = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(new byte[1024]);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        form.Add(fileContent, "file", fileName);
        form.Add(new StringContent("false"), "analyze"); // deferral — no dispatch needed here
        var resp = await client.PostAsync("/api/versions/", form);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        return (await resp.Content.ReadFromJsonAsync<UploadResponse>())!;
    }

    private async Task<string?> SongName(Guid songId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.Songs
            .Where(s => s.Id == songId)
            .Select(s => s.Name)
            .FirstOrDefaultAsync();
    }
}
