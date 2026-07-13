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

    [SkippableFact]
    public async Task Unknown_Handle_404s()
    {
        await TestDb.RequireAsync(_factory);
        var anon = _factory.CreateClient();
        var resp = await anon.GetAsync("/api/u/no-such-handle-ever");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [SkippableFact]
    public async Task Profile_Exposes_Only_Public_Versions()
    {
        await TestDb.RequireAsync(_factory);

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

    // ── Story 11.11 — handle search for @mention autocomplete ───────────────

    private async Task<string> SeedHandleAsync(string prefix, bool active = true)
    {
        var client = _factory.CreateClient();
        var (userId, _) = await TestAuth.RegisterAsync(client);
        var handle = $"{prefix}{Guid.NewGuid():N}"[..Math.Min(14, prefix.Length + 10)];
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = await db.Users.SingleAsync(u => u.Id == userId);
        user.Handle = handle;
        user.IsActive = active;
        await db.SaveChangesAsync();
        return handle;
    }

    private static async Task<List<string>> Search(HttpClient c, string q)
    {
        var resp = await c.GetAsync($"/api/u/?q={Uri.EscapeDataString(q)}");
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("items").EnumerateArray()
            .Select(i => i.GetProperty("handle").GetString()!).ToList();
    }

    [SkippableFact]
    public async Task Handle_Search_Prefix_Matches_Case_Insensitive_Active_Only()
    {
        await TestDb.RequireAsync(_factory);

        // Distinct prefix per run so parallel test data can't collide.
        var p = $"zq{Guid.NewGuid():N}"[..8];
        var hit = await SeedHandleAsync(p);
        var ghost = await SeedHandleAsync(p, active: false); // deactivated — never suggested

        var anon = _factory.CreateClient();

        var results = await Search(anon, p.ToUpperInvariant()); // citext: case-insensitive
        Assert.Contains(hit, results);
        Assert.DoesNotContain(ghost, results);

        // Non-prefix never matches (prefix search, not substring).
        var tail = hit[2..];
        Assert.DoesNotContain(hit, await Search(anon, tail));
    }

    [SkippableFact]
    public async Task Handle_Search_Caps_At_Eight_Results()
    {
        await TestDb.RequireAsync(_factory);

        var p = $"zc{Guid.NewGuid():N}"[..8];
        for (var i = 0; i < 9; i++) await SeedHandleAsync(p);

        var anon = _factory.CreateClient();
        Assert.Equal(8, (await Search(anon, p)).Count);
    }

    [SkippableFact]
    public async Task Handle_Search_Underscore_Matches_Literally_Not_As_Wildcard()
    {
        await TestDb.RequireAsync(_factory);

        // 'ab_...' must be matched by q='ab_' ; 'abX...' must NOT (an
        // unescaped '_' would be a single-char ILIKE wildcard and match both).
        var p = $"zu{Guid.NewGuid():N}"[..6];
        var literal = await SeedHandleAsync($"{p}_");
        var decoy = await SeedHandleAsync($"{p}x");

        var anon = _factory.CreateClient();
        var results = await Search(anon, $"{p}_");
        Assert.Contains(literal, results);
        Assert.DoesNotContain(decoy, results);
    }

    [SkippableFact]
    public async Task Handle_Search_Rejects_Junk_As_Empty_Not_Error()
    {
        await TestDb.RequireAsync(_factory);
        var anon = _factory.CreateClient();

        Assert.Empty(await Search(anon, ""));                    // empty
        Assert.Empty(await Search(anon, ".dot"));                // must start alphanumeric
        Assert.Empty(await Search(anon, "has space"));           // outside mention charset
        Assert.Empty(await Search(anon, "%"));                   // wildcard junk
        Assert.Empty(await Search(anon, new string('a', 31)));   // > 30 chars
    }
}
