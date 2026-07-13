using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using Xunit;

namespace Spectr.Bff.Tests;

// GET /api/jobs/{jobId}/images/{kind} — owner-scoped serving of the server-rendered
// result images. Requires Postgres (skips cleanly when unreachable, like the other
// read-path tests).
public sealed class AnalysisImageEndpointsTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private static readonly byte[] FakeWebp =
        Encoding.ASCII.GetBytes("RIFF\0\0\0\0WEBPfakebytes");


    private async Task<(HttpClient client, Guid userId)> RegisterAsync(HttpClient client)
    {
        var email = $"img+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email, password = "correct-horse-battery" });
        reg.EnsureSuccessStatusCode();
        var auth = await reg.Content.ReadFromJsonAsync<AuthResponse>();
        Assert.NotNull(auth);
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", auth!.AccessToken);
        return (client, auth.User.Id);
    }

    // Seeds a completed job + analysis owned by userId. When withImages, writes a
    // spectrogram webp via IFileStorage and stamps the path column.
    private async Task<Guid> SeedAsync(Guid userId, bool withImages)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var jobId = Guid.NewGuid();
        db.AnalysisJobs.Add(new AnalysisJob { Id = jobId, UserId = userId, Status = "complete", Tier = "free" });

        string? specKey = null;
        if (withImages)
        {
            specKey = $"analysis/images/{jobId}/spectrogram.webp";
            var storage = scope.ServiceProvider.GetRequiredService<IFileStorage>();
            using var ms = new MemoryStream(FakeWebp);
            await storage.WriteAsync(specKey, ms, "image/webp");
        }

        db.Analyses.Add(new Analysis
        {
            Id = Guid.NewGuid(),
            JobId = jobId,
            UserId = userId,
            FinalJson = "{}",
            SpectrogramImagePath = specKey,
        });
        await db.SaveChangesAsync();
        return jobId;
    }

    [SkippableFact]
    public async Task Owner_GetsSpectrogram_AsWebp()
    {
        await TestDb.RequireAsync(_factory);
        var (client, userId) = await RegisterAsync(_factory.CreateClient());
        var jobId = await SeedAsync(userId, withImages: true);

        var resp = await client.GetAsync($"/api/jobs/{jobId}/images/spectrogram");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        Assert.Equal("image/webp", resp.Content.Headers.ContentType?.MediaType);
        var bytes = await resp.Content.ReadAsByteArrayAsync();
        Assert.Equal(FakeWebp, bytes);
    }

    [SkippableFact]
    public async Task GetResults_SurfacesImageUrl_WhenPresent_NullWhenAbsent()
    {
        await TestDb.RequireAsync(_factory);
        var (client, userId) = await RegisterAsync(_factory.CreateClient());

        var withImg = await SeedAsync(userId, withImages: true);
        var withResults = await client.GetFromJsonAsync<JobResultsDto>($"/api/jobs/{withImg}/results");
        Assert.Equal($"/api/jobs/{withImg}/images/spectrogram", withResults!.SpectrogramImageUrl);
        Assert.Null(withResults.WaveformImageUrl);

        var without = await SeedAsync(userId, withImages: false);
        var noImg = await client.GetFromJsonAsync<JobResultsDto>($"/api/jobs/{without}/results");
        Assert.Null(noImg!.SpectrogramImageUrl);
        Assert.Null(noImg.WaveformImageUrl);
    }

    [SkippableFact]
    public async Task MissingPath_Returns404()
    {
        await TestDb.RequireAsync(_factory);
        var (client, userId) = await RegisterAsync(_factory.CreateClient());
        var jobId = await SeedAsync(userId, withImages: false);

        var resp = await client.GetAsync($"/api/jobs/{jobId}/images/spectrogram");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [SkippableFact]
    public async Task BadKind_Returns400()
    {
        await TestDb.RequireAsync(_factory);
        var (client, userId) = await RegisterAsync(_factory.CreateClient());
        var jobId = await SeedAsync(userId, withImages: true);

        var resp = await client.GetAsync($"/api/jobs/{jobId}/images/bogus");
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [SkippableFact]
    public async Task NonOwner_Gets404_Idor()
    {
        await TestDb.RequireAsync(_factory);
        var (_, ownerId) = await RegisterAsync(_factory.CreateClient());
        var jobId = await SeedAsync(ownerId, withImages: true);

        // A different user must not reach the owner's image.
        var (attacker, _) = await RegisterAsync(_factory.CreateClient());
        var resp = await attacker.GetAsync($"/api/jobs/{jobId}/images/spectrogram");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }
}
