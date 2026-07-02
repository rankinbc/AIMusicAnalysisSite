using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 11.8 — public profile endpoint: anonymous read, 404 unknown handle,
// PUBLIC-visibility-only projection (AC4).
public sealed class ProfileEndpointsTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    [Fact]
    public async Task Unknown_Handle_404s()
    {
        if (!await TestDb.Reachable(_factory)) { return; }
        var anon = _factory.CreateClient();
        var resp = await anon.GetAsync("/api/u/no-such-handle-ever");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task Profile_Exposes_Only_Public_Versions()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var client = _factory.CreateClient();
        var (userId, _) = await TestAuth.RegisterAsync(client);
        var handle = $"prof{Guid.NewGuid():N}"[..14];

        Guid publicVersion, unlistedVersion;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var user = await db.Users.SingleAsync(u => u.Id == userId);
            user.Handle = handle;
            user.DisplayName = "Prof Test";
            user.Bio = "public bio";

            var songId = Guid.NewGuid();
            db.Songs.Add(new Song { Id = songId, UserId = userId, Name = "Public Song" });
            publicVersion = Guid.NewGuid();
            unlistedVersion = Guid.NewGuid();
            db.SongVersions.Add(new SongVersion
            { Id = publicVersion, SongId = songId, VersionNumber = 1, FilePath = "x", IsCurrent = false });
            db.SongVersions.Add(new SongVersion
            { Id = unlistedVersion, SongId = songId, VersionNumber = 2, FilePath = "y", IsCurrent = true });
            db.ShareSettings.Add(new ShareSetting
            {
                SongVersionId = publicVersion, Visibility = "public",
                ShareToken = $"pub{Guid.NewGuid():N}"[..20], EnabledAt = DateTimeOffset.UtcNow,
            });
            db.ShareSettings.Add(new ShareSetting
            {
                SongVersionId = unlistedVersion, Visibility = "unlisted",
                ShareToken = $"unl{Guid.NewGuid():N}"[..20], EnabledAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var anon = _factory.CreateClient();
        var resp = await anon.GetAsync($"/api/u/{handle}");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(handle, body.GetProperty("handle").GetString());
        Assert.Equal("public bio", body.GetProperty("bio").GetString());
        var versions = body.GetProperty("publicVersions").EnumerateArray().ToList();
        Assert.Single(versions); // AC4 — unlisted never surfaces
        Assert.Equal(1, versions[0].GetProperty("versionNumber").GetInt32());
        Assert.StartsWith("pub", versions[0].GetProperty("shareToken").GetString());

        // Case-insensitive handle (citext).
        var upper = await anon.GetAsync($"/api/u/{handle.ToUpperInvariant()}");
        Assert.Equal(HttpStatusCode.OK, upper.StatusCode);
    }
}
