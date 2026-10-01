using System.Net;
using System.Net.Http.Headers;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Spectr.Bff.Tests;

// Fix wave FW2 (final review M4) — POST /api/anon/analyses is no longer used
// by the frontend (/analyze uploads as a guest since G5) and bypasses every
// guest limit, so it is off unless `anon_uploads_enabled` (or the config key
// Anon:UploadsEnabled, which wins) says "true". Off answers 404, as if the
// route did not exist, and stores nothing.
public sealed class AnonUploadsFlagTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private static MultipartFormDataContent WavForm()
    {
        // A minimal RIFF/WAVE header — passes the magic-byte sniff.
        var bytes = new byte[64];
        "RIFF"u8.CopyTo(bytes);
        "WAVE"u8.CopyTo(bytes.AsSpan(8));
        var content = new ByteArrayContent(bytes);
        content.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        return new MultipartFormDataContent { { content, "file", "flag-test.wav" } };
    }

    [SkippableFact]
    public async Task Upload_Is_Not_Found_When_The_Flag_Is_Off()
    {
        await TestDb.RequireAsync(factory);
        var f = factory.WithWebHostBuilder(b => b.UseSetting("Anon:UploadsEnabled", "false"));
        var client = f.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });

        var r = await client.PostAsync("/api/anon/analyses", WavForm());

        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
        // Every anon job is keyed by the device this route mints first; no
        // device cookie means nothing was stored or dispatched. (A DB
        // assertion would race the parallel AnonAnalysisTests' own jobs.)
        Assert.False(r.Headers.TryGetValues("Set-Cookie", out _), "no device should be minted");
    }
}
