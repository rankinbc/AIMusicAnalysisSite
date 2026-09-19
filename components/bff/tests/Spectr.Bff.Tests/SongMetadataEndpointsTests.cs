using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.DTOs;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Library-redesign — New Song metadata + hard delete. Song-level visibility
// (solo fork) and the tag public flag (solo fork) were both retired from the
// API surface; the entity columns stay until the DB task drops them.
// Postgres-gated (mirrors VersionShareEndpointsTests): skips when no DB.
public sealed class SongMetadataEndpointsTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    [SkippableFact]
    public async Task Create_And_Get_RoundTripsMetadata()
    {
        await TestDb.RequireAsync(_factory);
        var (client, _) = await NewAuthedClient();

        var created = await CreateSong(client, new
        {
            name = $"Meta {Guid.NewGuid():N}",
            genreHint = "trance",
            description = "notes to self",
            visualTemplate = "aurora",
            visualPrimary = "oklch(0.72 0.19 352)",
            visualSecondary = "oklch(0.55 0.12 240)",
            referenceProfileKind = "preset",
            referenceProfileId = "trance",
        });

        Assert.Equal("notes to self", created!.Description);
        Assert.Equal("aurora", created.VisualTemplate);
        Assert.Equal("oklch(0.72 0.19 352)", created.VisualPrimary);
        Assert.Equal("oklch(0.55 0.12 240)", created.VisualSecondary);
        Assert.Equal("preset", created.ReferenceProfileKind);
        Assert.Equal("trance", created.ReferenceProfileId);

        // GET returns the same metadata.
        var fetched = await client.GetFromJsonAsync<SongDto>($"/api/songs/{created.Id}");
        Assert.NotNull(fetched);
        Assert.Equal("notes to self", fetched!.Description);
        Assert.Equal("aurora", fetched.VisualTemplate);
        Assert.Equal("preset", fetched.ReferenceProfileKind);
        Assert.Equal("trance", fetched.ReferenceProfileId);
    }

    // Wave-2 (E2.4/E3.7) — explicit duplicate name returns the typed AR38 envelope.
    [SkippableFact]
    public async Task Create_DuplicateName_Returns409_WithSongNameConflictCode()
    {
        await TestDb.RequireAsync(_factory);
        var (client, _) = await NewAuthedClient();
        var name = $"Dup {Guid.NewGuid():N}";

        var first = await CreateSong(client, new { name });
        Assert.NotNull(first);

        var second = await client.PostAsJsonAsync("/api/songs/", new { name });
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
        using var doc = JsonDocument.Parse(await second.Content.ReadAsStringAsync());
        Assert.Equal("song_name_conflict",
            doc.RootElement.GetProperty("error").GetProperty("code").GetString());
        Assert.Equal("A song with that name already exists.",
            doc.RootElement.GetProperty("error").GetProperty("message").GetString());
    }

    [SkippableFact]
    public async Task Patch_UpdatesDescription_AndPersists()
    {
        await TestDb.RequireAsync(_factory);
        var (client, _) = await NewAuthedClient();
        var song = await CreateSong(client, new { name = $"Desc {Guid.NewGuid():N}" });

        var patch = await client.PatchAsJsonAsync($"/api/songs/{song!.Id}",
            new { description = "shared with the band" });
        Assert.Equal(HttpStatusCode.NoContent, patch.StatusCode);

        var fetched = await client.GetFromJsonAsync<SongDto>($"/api/songs/{song.Id}");
        Assert.Equal("shared with the band", fetched!.Description);
    }

    [SkippableFact]
    public async Task HardDelete_RemovesSongVersionsAndTags_AndIsOwnerScoped()
    {
        await TestDb.RequireAsync(_factory);
        var (owner, _) = await NewAuthedClient();
        var song = await CreateSong(owner, new { name = $"Doomed {Guid.NewGuid():N}" });
        var versionId = await CreateVersionForSong(owner, song!.Id);

        // Add a tag so we exercise the child-row cleanup.
        var tagResp = await owner.PostAsJsonAsync($"/api/songs/{song.Id}/tags",
            new { name = "wip" });
        Assert.Equal(HttpStatusCode.Created, tagResp.StatusCode);

        // Another user cannot hard-delete it.
        var (attacker, _) = await NewAuthedClient();
        var attack = await attacker.DeleteAsync($"/api/songs/{song.Id}/permanent");
        Assert.Equal(HttpStatusCode.NotFound, attack.StatusCode);
        // Still there for the owner.
        Assert.Equal(HttpStatusCode.OK, (await owner.GetAsync($"/api/songs/{song.Id}")).StatusCode);

        // Owner hard-delete succeeds.
        var del = await owner.DeleteAsync($"/api/songs/{song.Id}/permanent");
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);

        // Song gone, version gone.
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync($"/api/songs/{song.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await owner.GetAsync($"/api/versions/{versionId}/files")).StatusCode);
    }

    [SkippableFact]
    public async Task Archive_StillOnlySetsArchivedAt_NotHardDelete()
    {
        await TestDb.RequireAsync(_factory);
        var (owner, _) = await NewAuthedClient();
        var song = await CreateSong(owner, new { name = $"Arch {Guid.NewGuid():N}" });

        var archive = await owner.DeleteAsync($"/api/songs/{song!.Id}");
        Assert.Equal(HttpStatusCode.NoContent, archive.StatusCode);

        // The row still exists; only archived_at is stamped.
        var fetched = await owner.GetFromJsonAsync<SongDto>($"/api/songs/{song.Id}");
        Assert.NotNull(fetched);
        Assert.NotNull(fetched!.ArchivedAt);
    }

    // Solo fork discovery — tags carried a per-tag "public" flag with a
    // cross-user read path (ReportsEndpoints.cs used to OR in `st.IsPublic`).
    // Wire contracts must never re-admit it.
    [Fact]
    public void TagDto_And_CreateTagRequest_Have_No_IsPublic_Property()
    {
        Assert.Null(typeof(TagDto).GetProperty("IsPublic"));
        Assert.Null(typeof(CreateTagRequest).GetProperty("IsPublic"));
    }

    // Behavioural counterpart: even if a legacy is_public=true tag row exists
    // on the caller's OWN song (a shape only reachable via direct data
    // manipulation now that every write path is owner-scoped), GET
    // /api/reports must never surface a tag belonging to another user — not
    // in the unfiltered Tags list, and not as a match for the ?tags= filter.
    [SkippableFact]
    public async Task Reports_List_Never_Returns_Another_Users_Tag_On_Callers_Own_Song()
    {
        await TestDb.RequireAsync(_factory);

        var client = _factory.CreateClient();
        var (ownerId, ownerToken) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", ownerToken);

        var otherClient = _factory.CreateClient();
        var (otherUserId, _) = await TestAuth.RegisterAsync(otherClient);

        var songId = Guid.NewGuid();
        var versionId = Guid.NewGuid();
        var jobId = Guid.NewGuid();

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Songs.Add(new Song { Id = songId, UserId = ownerId, Name = $"Leak {Guid.NewGuid():N}" });
            db.SongVersions.Add(new SongVersion
            {
                Id = versionId, SongId = songId, VersionNumber = 1,
                Label = "v1", IsCurrent = true, FilePath = "x.wav",
            });
            db.AnalysisJobs.Add(new AnalysisJob
            {
                Id = jobId, UserId = ownerId, VersionId = versionId, Status = "complete",
            });
            // Owner's own tag — must still be visible.
            db.SongTags.Add(new SongTag { SongId = songId, UserId = ownerId, Name = "mine", IsPublic = false });
            // A tag row belonging to ANOTHER user on the CALLER's own song,
            // with the legacy is_public flag set — exactly the shape the
            // retired `st.UserId == userId || st.IsPublic` predicate leaked.
            db.SongTags.Add(new SongTag { SongId = songId, UserId = otherUserId, Name = "leaked", IsPublic = true });
            await db.SaveChangesAsync();
        }

        var listResp = await client.GetAsync("/api/reports/");
        listResp.EnsureSuccessStatusCode();
        var list = await listResp.Content.ReadFromJsonAsync<ReportListResponse>();
        var item = Assert.Single(list!.Items, i => i.JobId == jobId);
        Assert.Contains(item.Tags, t => t.Name == "mine");
        Assert.DoesNotContain(item.Tags, t => t.Name == "leaked");

        // The tag-name filter must not treat the other user's tag as a match either.
        var filteredResp = await client.GetAsync("/api/reports/?tags=leaked");
        filteredResp.EnsureSuccessStatusCode();
        var filtered = await filteredResp.Content.ReadFromJsonAsync<ReportListResponse>();
        Assert.Empty(filtered!.Items);
    }

    // ── helpers ──────────────────────────────────────────────────────────────
    private async Task<(HttpClient client, string email)> NewAuthedClient()
    {
        var client = _factory.CreateClient();
        var email = $"songmeta+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email, password = "correct-horse-battery" });
        reg.EnsureSuccessStatusCode();
        var auth = await reg.Content.ReadFromJsonAsync<AuthResponse>();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", auth!.AccessToken);
        return (client, email);
    }

    private static async Task<SongDto?> CreateSong(HttpClient client, object body)
    {
        var resp = await client.PostAsJsonAsync("/api/songs/", body);
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadFromJsonAsync<SongDto>();
    }

    private static async Task<Guid> CreateVersionForSong(HttpClient client, Guid songId)
    {
        using var form = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(new byte[512]);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        form.Add(fileContent, "file", "song-meta.wav");
        form.Add(new StringContent(songId.ToString()), "song_id");
        form.Add(new StringContent("false"), "analyze");
        var resp = await client.PostAsync("/api/versions/", form);
        resp.EnsureSuccessStatusCode();
        return (await resp.Content.ReadFromJsonAsync<UploadResponse>())!.VersionId;
    }

}
