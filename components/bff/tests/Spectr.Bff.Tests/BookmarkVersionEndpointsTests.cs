using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.DTOs;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Listen V3 (PRP-6) — version bookmarking. Postgres-gated. Covers authed version
// bookmark (+t+note+dedup+identity toggle), the canBookmark gate, anon bookmark
// via the share link counting toward the author signal, the owner-gated signal
// with identity opt-in (D5.4), and the 3-way polymorphic CHECK.
public sealed class BookmarkVersionEndpointsTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    [SkippableFact]
    public async Task AuthedBookmarkVersion_WithTNote_Dedups_AndTogglesIdentity()
    {
        await TestDb.RequireAsync(_factory);
        var (owner, _, _) = await NewAuthedClient();
        var versionId = await CreateVersion(owner);

        var post = await owner.PostAsJsonAsync("/api/me/bookmarks",
            new { targetVersionId = versionId, t = 84.0, note = "great transition", identityVisible = true });
        Assert.Equal(HttpStatusCode.Created, post.StatusCode);
        var dto = await post.Content.ReadFromJsonAsync<BookmarkDto>();
        Assert.Equal(versionId, dto!.TargetVersionId);
        Assert.Equal(84.0, dto.T);
        Assert.True(dto.IdentityVisible);

        // Repeat (same version + t) dedups to the same row, and can flip identity.
        var again = await owner.PostAsJsonAsync("/api/me/bookmarks",
            new { targetVersionId = versionId, t = 84.0, identityVisible = false });
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        var dto2 = await again.Content.ReadFromJsonAsync<BookmarkDto>();
        Assert.Equal(dto.Id, dto2!.Id);
        Assert.False(dto2.IdentityVisible);

        var list = await owner.GetFromJsonAsync<List<BookmarkDto>>("/api/me/bookmarks");
        Assert.Single(list!, b => b.TargetVersionId == versionId);
    }

    // Audit wave-3 (E7.4) — the upsert updates the note on a repeat POST so the
    // frontend edits notes with a single request. Contract: note "" clears,
    // absent/null preserves (the identity-toggle caller posts without a note key).
    [SkippableFact]
    public async Task RepeatPost_UpsertsNote_EmptyClears_AbsentPreserves()
    {
        await TestDb.RequireAsync(_factory);
        var (owner, _, _) = await NewAuthedClient();
        var versionId = await CreateVersion(owner);

        var post = await owner.PostAsJsonAsync("/api/me/bookmarks",
            new { targetVersionId = versionId, t = 12.0, note = "first take", identityVisible = true });
        Assert.Equal(HttpStatusCode.Created, post.StatusCode);
        var created = await post.Content.ReadFromJsonAsync<BookmarkDto>();
        Assert.Equal("first take", created!.Note);

        // Repeat POST with a new note → same row, note updated.
        var edit = await owner.PostAsJsonAsync("/api/me/bookmarks",
            new { targetVersionId = versionId, t = 12.0, note = "second take", identityVisible = true });
        Assert.Equal(HttpStatusCode.OK, edit.StatusCode);
        var edited = await edit.Content.ReadFromJsonAsync<BookmarkDto>();
        Assert.Equal(created.Id, edited!.Id);
        Assert.Equal("second take", edited.Note);

        // Repeat POST WITHOUT a note key (the name-toggle call) → note preserved,
        // identity toggled (the toggleName regression case).
        var toggle = await owner.PostAsJsonAsync("/api/me/bookmarks",
            new { targetVersionId = versionId, t = 12.0, identityVisible = false });
        Assert.Equal(HttpStatusCode.OK, toggle.StatusCode);
        var toggled = await toggle.Content.ReadFromJsonAsync<BookmarkDto>();
        Assert.Equal(created.Id, toggled!.Id);
        Assert.Equal("second take", toggled.Note);
        Assert.False(toggled.IdentityVisible);

        // Repeat POST with note "" → note cleared to null.
        var clear = await owner.PostAsJsonAsync("/api/me/bookmarks",
            new { targetVersionId = versionId, t = 12.0, note = "", identityVisible = false });
        Assert.Equal(HttpStatusCode.OK, clear.StatusCode);
        var cleared = await clear.Content.ReadFromJsonAsync<BookmarkDto>();
        Assert.Equal(created.Id, cleared!.Id);
        Assert.Null(cleared.Note);

        // The update persisted (not just projected onto the response DTO).
        var list = await owner.GetFromJsonAsync<List<BookmarkDto>>("/api/me/bookmarks");
        var row = Assert.Single(list!, b => b.TargetVersionId == versionId);
        Assert.Null(row.Note);
        Assert.False(row.IdentityVisible);
    }

    [SkippableFact]
    public async Task BookmarkVersion_BlockedWhenBookmarkingDisallowed()
    {
        await TestDb.RequireAsync(_factory);
        var (owner, _, _) = await NewAuthedClient();
        var versionId = await CreateVersion(owner);
        await owner.PutAsJsonAsync($"/api/versions/{versionId}/share",
            new { visibility = "unlisted", bookmarkingAllowed = false });

        var post = await owner.PostAsJsonAsync("/api/me/bookmarks", new { targetVersionId = versionId });
        Assert.Equal(HttpStatusCode.Forbidden, post.StatusCode);
    }

    [SkippableFact]
    public async Task AnonBookmark_ViaShareLink_CountsInSignal_Anonymously()
    {
        await TestDb.RequireAsync(_factory);
        var (owner, _, _) = await NewAuthedClient();
        var versionId = await CreateVersion(owner);
        var share = await (await owner.PutAsJsonAsync($"/api/versions/{versionId}/share",
            new { visibility = "unlisted", bookmarkingAllowed = true }))
            .Content.ReadFromJsonAsync<ShareSettingsDto>();
        var token = share!.ShareToken!;

        var anon = _factory.CreateClient();
        var bm = await anon.PostAsJsonAsync($"/api/v/{token}/bookmark", new { t = 12.0, note = "nice" });
        Assert.Equal(HttpStatusCode.Created, bm.StatusCode);
        // NB: anon dedup keys on the durable signed `spectr_anon` cookie, which is
        // Secure — the in-memory http test client doesn't round-trip it, so each
        // anon request mints a fresh anonId here. Dedup is therefore exercised over
        // https in prod (+ the authed-dedup test above); not asserted in-process.

        var signal = await owner.GetFromJsonAsync<BookmarkSignalDto>($"/api/versions/{versionId}/bookmarks/signal");
        Assert.Equal(1, signal!.Count);     // anon bookmark counted...
        Assert.Empty(signal.Identified);    // ...but never identified (D5.4)
    }

    [SkippableFact]
    public async Task Signal_IdentifiesOnlyOptedInNamed_AndIsOwnerGated()
    {
        await TestDb.RequireAsync(_factory);
        var (owner, _, _) = await NewAuthedClient();
        var versionId = await CreateVersion(owner);
        var (reviewer, reviewerEmail, reviewerId) = await NewAuthedClient();
        await owner.PostAsJsonAsync($"/api/versions/{versionId}/invites",
            new { role = "reviewer", invitedEmail = reviewerEmail });

        // Reviewer bookmarks with identity_visible=true → should be identified.
        await reviewer.PostAsJsonAsync("/api/me/bookmarks",
            new { targetVersionId = versionId, identityVisible = true });

        var signal = await owner.GetFromJsonAsync<BookmarkSignalDto>($"/api/versions/{versionId}/bookmarks/signal");
        Assert.Equal(1, signal!.Count);
        Assert.Single(signal.Identified);
        Assert.Equal(reviewerId, signal.Identified[0].UserId);

        // Non-owner can't read the signal.
        var forbidden = await reviewer.GetAsync($"/api/versions/{versionId}/bookmarks/signal");
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
    }

    [SkippableFact]
    public async Task ThreeWayCheck_RejectsTwoTargets()
    {
        await TestDb.RequireAsync(_factory);
        var (owner, _, ownerId) = await NewAuthedClient();
        var versionId = await CreateVersion(owner);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.TrackBookmarks.Add(new TrackBookmark
        {
            Id = Guid.NewGuid(),
            UserId = ownerId,
            TargetShareToken = "tok",
            TargetVersionId = versionId,   // two targets → CHECK violation
        });
        await Assert.ThrowsAnyAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    // ── helpers ──────────────────────────────────────────────────────────────
    private async Task<(HttpClient Client, string Email, Guid UserId)> NewAuthedClient()
    {
        var client = _factory.CreateClient();
        var email = $"bm+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email, password = "correct-horse-battery" });
        reg.EnsureSuccessStatusCode();
        var auth = await reg.Content.ReadFromJsonAsync<AuthResponse>();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth!.AccessToken);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var userId = await db.Users.AsNoTracking().Where(u => u.Email == email).Select(u => u.Id).FirstAsync();
        return (client, email, userId);
    }

    private static async Task<Guid> CreateVersion(HttpClient client)
    {
        using var form = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(new byte[512]);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        form.Add(fileContent, "file", "bm-test.wav");
        form.Add(new StringContent("false"), "analyze");
        var resp = await client.PostAsync("/api/versions/", form);
        resp.EnsureSuccessStatusCode();
        return (await resp.Content.ReadFromJsonAsync<UploadResponse>())!.VersionId;
    }

}
