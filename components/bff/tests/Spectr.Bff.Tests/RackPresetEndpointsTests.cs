using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.DTOs;
using Spectr.Data;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Listen V3 (PRP-1) — rack presets / draft / viz endpoints. Asserts version-
// ownership IDOR scoping (rack), user scoping (viz), draft uniqueness on
// song_version_id, and chain validation. Postgres-gated like the other
// integration tests (graceful skip when the DB isn't reachable).
public sealed class RackPresetEndpointsTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private static object SampleChain(bool bypass = false) => new
    {
        order = new[] { "eq", "comp" },
        modules = new { eq = new { enabled = true }, comp = new { enabled = false } },
        masterBypass = bypass,
    };

    [SkippableFact]
    public async Task SavePreset_OnOwnedVersion_PersistsAndLists()
    {
        await TestDb.RequireAsync(_factory);
        var client = NewClient();
        await Authenticate(client);
        var versionId = await CreateVersion(client);

        var save = await client.PostAsJsonAsync(
            $"/api/versions/{versionId}/rack/presets",
            new { name = "  My Preset  ", chain = SampleChain(bypass: true) });
        Assert.Equal(HttpStatusCode.Created, save.StatusCode);
        var dto = await save.Content.ReadFromJsonAsync<RackPresetDto>();
        Assert.NotNull(dto);
        Assert.Equal("My Preset", dto!.Name);   // trimmed
        Assert.Equal("user", dto.Source);

        var list = await client.GetFromJsonAsync<List<RackPresetDto>>(
            $"/api/versions/{versionId}/rack/presets");
        Assert.Single(list!);
        Assert.Equal(dto.Id, list![0].Id);
    }

    [SkippableFact]
    public async Task SavePreset_OnAnotherUsersVersion_Returns404()
    {
        await TestDb.RequireAsync(_factory);

        var owner = NewClient();
        await Authenticate(owner);
        var versionId = await CreateVersion(owner);

        var attacker = NewClient();
        await Authenticate(attacker);

        var resp = await attacker.PostAsJsonAsync(
            $"/api/versions/{versionId}/rack/presets",
            new { name = "evil", chain = SampleChain() });
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);

        // And the attacker can't list the owner's presets either.
        var list = await attacker.GetAsync($"/api/versions/{versionId}/rack/presets");
        Assert.Equal(HttpStatusCode.NotFound, list.StatusCode);

        Assert.Equal(0, await PresetCount(versionId));
    }

    [SkippableFact]
    public async Task SavePreset_NonObjectChain_Returns400()
    {
        await TestDb.RequireAsync(_factory);
        var client = NewClient();
        await Authenticate(client);
        var versionId = await CreateVersion(client);

        var resp = await client.PostAsJsonAsync(
            $"/api/versions/{versionId}/rack/presets",
            new { name = "bad", chain = "not-an-object" });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        Assert.Equal(0, await PresetCount(versionId));
    }

    [SkippableFact]
    public async Task DeletePreset_RemovesRow_ThenNotFound()
    {
        await TestDb.RequireAsync(_factory);
        var client = NewClient();
        await Authenticate(client);
        var versionId = await CreateVersion(client);

        var dto = await (await client.PostAsJsonAsync(
            $"/api/versions/{versionId}/rack/presets",
            new { name = "p", chain = SampleChain() })).Content.ReadFromJsonAsync<RackPresetDto>();

        var del1 = await client.DeleteAsync($"/api/versions/{versionId}/rack/presets/{dto!.Id}");
        Assert.Equal(HttpStatusCode.NoContent, del1.StatusCode);
        var del2 = await client.DeleteAsync($"/api/versions/{versionId}/rack/presets/{dto.Id}");
        Assert.Equal(HttpStatusCode.NotFound, del2.StatusCode);
        Assert.Equal(0, await PresetCount(versionId));
    }

    [SkippableFact]
    public async Task Draft_SecondPut_UpdatesSameRow_NotASecond()
    {
        await TestDb.RequireAsync(_factory);
        var client = NewClient();
        await Authenticate(client);
        var versionId = await CreateVersion(client);

        // No draft yet → 204.
        var empty = await client.GetAsync($"/api/versions/{versionId}/rack/draft");
        Assert.Equal(HttpStatusCode.NoContent, empty.StatusCode);

        var put1 = await client.PutAsJsonAsync(
            $"/api/versions/{versionId}/rack/draft", new { chain = SampleChain(bypass: false) });
        Assert.Equal(HttpStatusCode.OK, put1.StatusCode);

        var put2 = await client.PutAsJsonAsync(
            $"/api/versions/{versionId}/rack/draft", new { chain = SampleChain(bypass: true) });
        Assert.Equal(HttpStatusCode.OK, put2.StatusCode);

        // UNIQUE(song_version_id) — upsert updated the same row, didn't insert a 2nd.
        Assert.Equal(1, await DraftCount(versionId));

        var draft = await client.GetFromJsonAsync<RackDraftDto>($"/api/versions/{versionId}/rack/draft");
        Assert.NotNull(draft);
        Assert.Equal(versionId, draft!.SongVersionId);
    }

    [SkippableFact]
    public async Task Draft_OnAnotherUsersVersion_Returns404()
    {
        await TestDb.RequireAsync(_factory);
        var owner = NewClient();
        await Authenticate(owner);
        var versionId = await CreateVersion(owner);

        var attacker = NewClient();
        await Authenticate(attacker);
        var resp = await attacker.PutAsJsonAsync(
            $"/api/versions/{versionId}/rack/draft", new { chain = SampleChain() });
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        Assert.Equal(0, await DraftCount(versionId));
    }

    [SkippableFact]
    public async Task VizPresets_AreUserScoped()
    {
        await TestDb.RequireAsync(_factory);
        var a = NewClient();
        await Authenticate(a);
        var b = NewClient();
        await Authenticate(b);

        var save = await a.PostAsJsonAsync("/api/viz/presets",
            new { name = "Neon", viz = new { viz = new { barColor = "#0ff" }, stages = new[] { "eq" }, director = "pulse" } });
        Assert.Equal(HttpStatusCode.Created, save.StatusCode);
        var dto = await save.Content.ReadFromJsonAsync<VizPresetDto>();

        var aList = await a.GetFromJsonAsync<List<VizPresetDto>>("/api/viz/presets");
        Assert.Single(aList!);

        // User B sees none of A's looks.
        var bList = await b.GetFromJsonAsync<List<VizPresetDto>>("/api/viz/presets");
        Assert.Empty(bList!);

        // B can't delete A's look.
        var bDel = await b.DeleteAsync($"/api/viz/presets/{dto!.Id}");
        Assert.Equal(HttpStatusCode.NotFound, bDel.StatusCode);

        var aDel = await a.DeleteAsync($"/api/viz/presets/{dto.Id}");
        Assert.Equal(HttpStatusCode.NoContent, aDel.StatusCode);
    }

    // ── helpers ──────────────────────────────────────────────────────────────
    // ── Story 12.4: GET preset by id — the fix-rack carry-over fetch ────────

    [SkippableFact]
    public async Task GetPreset_ById_Returns_Analysis_Source_Row()
    {
        await TestDb.RequireAsync(_factory);
        var client = NewClient();
        await Authenticate(client);
        var versionId = await CreateVersion(client);

        // Seed an ANALYSIS-source preset directly (the generator's row shape);
        // ListPresets must keep hiding it, GET-by-id must serve it.
        Guid presetId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var row = new Spectr.Data.Entities.RackPreset
            {
                Id = Guid.NewGuid(),
                SongVersionId = versionId,
                Name = "Coach fix rack",
                Source = "analysis",
                ChainJson = System.Text.Json.JsonSerializer.Serialize(SampleChain()),
            };
            db.RackPresets.Add(row);
            await db.SaveChangesAsync();
            presetId = row.Id;
        }

        var byId = await client.GetFromJsonAsync<RackPresetDto>(
            $"/api/versions/{versionId}/rack/presets/{presetId}");
        Assert.NotNull(byId);
        Assert.Equal(presetId, byId!.Id);
        Assert.Equal("analysis", byId.Source);
        Assert.Equal("Coach fix rack", byId.Name);

        // The personal library stays user-source-only (11-2 decision).
        var list = await client.GetFromJsonAsync<List<RackPresetDto>>(
            $"/api/versions/{versionId}/rack/presets");
        Assert.DoesNotContain(list!, p => p.Id == presetId);
    }

    [SkippableFact]
    public async Task GetPreset_ById_ForeignUser_Returns404()
    {
        await TestDb.RequireAsync(_factory);

        var owner = NewClient();
        await Authenticate(owner);
        var versionId = await CreateVersion(owner);
        var save = await owner.PostAsJsonAsync(
            $"/api/versions/{versionId}/rack/presets",
            new { name = "mine", chain = SampleChain() });
        var dto = await save.Content.ReadFromJsonAsync<RackPresetDto>();

        var attacker = NewClient();
        await Authenticate(attacker);
        var resp = await attacker.GetAsync(
            $"/api/versions/{versionId}/rack/presets/{dto!.Id}");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [SkippableFact]
    public async Task GetPreset_ById_UnknownId_Returns404()
    {
        await TestDb.RequireAsync(_factory);
        var client = NewClient();
        await Authenticate(client);
        var versionId = await CreateVersion(client);

        var resp = await client.GetAsync(
            $"/api/versions/{versionId}/rack/presets/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    private HttpClient NewClient() => _factory.CreateClient();

    private static async Task Authenticate(HttpClient client)
    {
        var email = $"rack+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email, password = "correct-horse-battery" });
        reg.EnsureSuccessStatusCode();
        var auth = await reg.Content.ReadFromJsonAsync<AuthResponse>();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", auth!.AccessToken);
    }

    // Deferred upload (analyze=false) → just creates a version we own.
    private static async Task<Guid> CreateVersion(HttpClient client)
    {
        using var form = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(new byte[512]);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        form.Add(fileContent, "file", "rack-test.wav");
        form.Add(new StringContent("false"), "analyze");
        var resp = await client.PostAsync("/api/versions/", form);
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<UploadResponse>();
        return body!.VersionId;
    }

    private async Task<int> PresetCount(Guid versionId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.RackPresets.CountAsync(p => p.SongVersionId == versionId);
    }

    private async Task<int> DraftCount(Guid versionId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.RackDrafts.CountAsync(d => d.SongVersionId == versionId);
    }

}
