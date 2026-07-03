using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 11.10 — activity feed: followed users' public shares + published
// recaps, reverse-chron, recipient-scoped, visibility-gated (AC1/2/4).
public sealed class FeedEndpointsTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private async Task<(HttpClient Client, Guid UserId, string Handle)> AuthedWithHandleAsync()
    {
        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var handle = $"fed{Guid.NewGuid():N}"[..14];
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = await db.Users.SingleAsync(u => u.Id == userId);
        user.Handle = handle;
        await db.SaveChangesAsync();
        return (client, userId, handle);
    }

    /// <summary>Seeds a song+version with a ShareSetting in the given visibility.</summary>
    private async Task<Guid> SeedShareAsync(
        Guid ownerId, string visibility, DateTimeOffset enabledAt, string? token = "unset")
    {
        var (_, versionId) = await TestSeed.SongWithVersionAsync(_factory, ownerId);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.ShareSettings.Add(new ShareSetting
        {
            SongVersionId = versionId,
            Visibility = visibility,
            ShareToken = token == "unset" ? Guid.NewGuid().ToString() : token,
            EnabledAt = enabledAt,
        });
        await db.SaveChangesAsync();
        return versionId;
    }

    private async Task SeedRecapAsync(Guid hostId, Guid versionId, DateTimeOffset? publishedAt)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.ListeningSessions.Add(new ListeningSession
        {
            SongVersionId = versionId,
            HostId = hostId,
            Status = "ended",
            EndedAt = publishedAt ?? DateTimeOffset.UtcNow,
            RecapJson = """{"hottestMoments":[{"t":12.0,"reactionCount":3,"topEmoji":"🔥"}]}""",
            RecapPublishedAt = publishedAt,
        });
        await db.SaveChangesAsync();
    }

    private static async Task<JsonElement> Feed(HttpClient c, int page = 0, int? limit = null)
    {
        var url = $"/api/me/feed/?page={page}" + (limit is int l ? $"&limit={l}" : "");
        var resp = await c.GetAsync(url);
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadFromJsonAsync<JsonElement>();
    }

    [Fact]
    public async Task Feed_Shows_Followed_Public_Shares_Only_Reverse_Chron()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (reader, _, _) = await AuthedWithHandleAsync();
        var (_, aliceId, aliceHandle) = await AuthedWithHandleAsync();
        var (_, strangerId, _) = await AuthedWithHandleAsync();

        var t0 = DateTimeOffset.UtcNow.AddMinutes(-30);
        await SeedShareAsync(aliceId, "public", t0);                       // older
        await SeedShareAsync(aliceId, "public", t0.AddMinutes(10));        // newer
        await SeedShareAsync(aliceId, "private", t0.AddMinutes(20), null); // never surfaces (AC4)
        await SeedShareAsync(aliceId, "unlisted", t0.AddMinutes(20));      // never surfaces (AC4)
        await SeedShareAsync(strangerId, "public", t0.AddMinutes(25));     // not followed

        Assert.Equal(HttpStatusCode.NoContent,
            (await reader.PutAsync($"/api/u/{aliceHandle}/follow/", null)).StatusCode);

        var feed = await Feed(reader);
        var items = feed.GetProperty("items").EnumerateArray().ToList();

        Assert.Equal(2, items.Count); // only Alice's two PUBLIC shares
        Assert.All(items, i => Assert.Equal("share", i.GetProperty("kind").GetString()));
        Assert.All(items, i => Assert.Equal(aliceHandle, i.GetProperty("handle").GetString()));
        // reverse-chron: newer first (AC1)
        var ts = items.Select(i => i.GetProperty("occurredAt").GetDateTimeOffset()).ToList();
        Assert.True(ts[0] > ts[1]);
        Assert.False(feed.GetProperty("hasMore").GetBoolean());
    }

    [Fact]
    public async Task Feed_Shows_Published_Recaps_Gated_On_Public_Version()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (reader, _, _) = await AuthedWithHandleAsync();
        var (_, hostId, hostHandle) = await AuthedWithHandleAsync();

        var t0 = DateTimeOffset.UtcNow.AddMinutes(-30);
        var publicVersion = await SeedShareAsync(hostId, "public", t0);
        var privateVersion = await SeedShareAsync(hostId, "private", t0, null);

        await SeedRecapAsync(hostId, publicVersion, t0.AddMinutes(5));   // published, public → surfaces
        await SeedRecapAsync(hostId, publicVersion, null);               // NOT published → hidden
        await SeedRecapAsync(hostId, privateVersion, t0.AddMinutes(6));  // published on private → hidden (AC4)

        Assert.Equal(HttpStatusCode.NoContent,
            (await reader.PutAsync($"/api/u/{hostHandle}/follow/", null)).StatusCode);

        var feed = await Feed(reader);
        var items = feed.GetProperty("items").EnumerateArray().ToList();

        var recaps = items.Where(i => i.GetProperty("kind").GetString() == "recap").ToList();
        Assert.Single(recaps); // only the published recap on the public version
        Assert.Equal(hostHandle, recaps[0].GetProperty("handle").GetString());
        // the public share itself also appears (share item) — both kinds coexist
        Assert.Contains(items, i => i.GetProperty("kind").GetString() == "share");
    }

    [Fact]
    public async Task Empty_Feed_Carries_Suggestions_And_Requires_Auth()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (reader, readerId, readerHandle) = await AuthedWithHandleAsync();
        var (_, sharerId, sharerHandle) = await AuthedWithHandleAsync();
        await SeedShareAsync(sharerId, "public", DateTimeOffset.UtcNow);
        // The reader ALSO has a public share — proves the self-exclusion branch
        // for real (a reader with no shares is vacuously absent from suggestions).
        await SeedShareAsync(readerId, "public", DateTimeOffset.UtcNow);

        // Follows no one → empty items + suggestions including the public sharer (AC2).
        var feed = await Feed(reader);
        Assert.Empty(feed.GetProperty("items").EnumerateArray());
        var suggestions = feed.GetProperty("suggestions").EnumerateArray().ToList();
        Assert.Contains(suggestions, s => s.GetProperty("handle").GetString() == sharerHandle);
        // Never suggests myself — despite my own public share being the newest.
        Assert.DoesNotContain(suggestions, s => s.GetProperty("handle").GetString() == readerHandle);

        // Unauthed → 401 (recipient-scoped, AC4).
        var anon = _factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync("/api/me/feed/")).StatusCode);
    }

    [Fact]
    public async Task Deactivated_Followee_Content_Never_Surfaces()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (reader, _, _) = await AuthedWithHandleAsync();
        var (_, ghostId, ghostHandle) = await AuthedWithHandleAsync();
        var ghostVersion = await SeedShareAsync(ghostId, "public", DateTimeOffset.UtcNow.AddMinutes(-5));
        await SeedRecapAsync(ghostId, ghostVersion, DateTimeOffset.UtcNow.AddMinutes(-4));

        Assert.Equal(HttpStatusCode.NoContent,
            (await reader.PutAsync($"/api/u/{ghostHandle}/follow/", null)).StatusCode);

        // Deactivate the followee — their share AND recap must drop out
        // (their /u/{handle} deep-link would 404, so surfacing them is a trap).
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var ghost = await db.Users.SingleAsync(u => u.Id == ghostId);
            ghost.IsActive = false;
            await db.SaveChangesAsync();
        }

        var feed = await Feed(reader);
        Assert.Empty(feed.GetProperty("items").EnumerateArray());
    }

    [Fact]
    public async Task Feed_Pages_With_HasMore()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (reader, _, _) = await AuthedWithHandleAsync();
        var (_, aliceId, aliceHandle) = await AuthedWithHandleAsync();

        var t0 = DateTimeOffset.UtcNow.AddMinutes(-60);
        for (var i = 0; i < 3; i++)
            await SeedShareAsync(aliceId, "public", t0.AddMinutes(i));

        Assert.Equal(HttpStatusCode.NoContent,
            (await reader.PutAsync($"/api/u/{aliceHandle}/follow/", null)).StatusCode);

        var page0 = await Feed(reader, page: 0, limit: 2);
        Assert.Equal(2, page0.GetProperty("items").GetArrayLength());
        Assert.True(page0.GetProperty("hasMore").GetBoolean());

        var page1 = await Feed(reader, page: 1, limit: 2);
        Assert.Equal(1, page1.GetProperty("items").GetArrayLength());
        Assert.False(page1.GetProperty("hasMore").GetBoolean());
        // page > 0 never carries suggestions
        Assert.True(page1.GetProperty("suggestions").ValueKind == JsonValueKind.Null);
    }
}
