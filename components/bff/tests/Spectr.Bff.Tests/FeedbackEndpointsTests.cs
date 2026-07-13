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

// Listen V3 (PRP-3) — View feedback: comments + suggestions, gated via AccessService.
// Postgres-gated. Covers authed post + owner-only moderation, anon comment by policy,
// suggestion accept→fork-to-preset (from_suggestion_id) + non-owner 403, and the
// 3-way polymorphic CHECK.
public sealed class FeedbackEndpointsTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private static object SampleChain() => new
    {
        order = new[] { "eq", "comp" },
        modules = new { eq = new { enabled = true }, comp = new { enabled = false } },
        masterBypass = false,
    };

    [SkippableFact]
    public async Task OwnerPostsComment_ListsIt_AndModeratesStatus()
    {
        await TestDb.RequireAsync(_factory);
        var (owner, _) = await NewAuthedClient();
        var versionId = await CreateVersion(owner);

        var post = await owner.PostAsJsonAsync($"/api/versions/{versionId}/comments",
            new { body = "Kick is boomy", t = 12.5 });
        Assert.Equal(HttpStatusCode.Created, post.StatusCode);
        var dto = await post.Content.ReadFromJsonAsync<CommentDto>();
        Assert.Equal("open", dto!.Status);
        Assert.Equal("user", dto.Author.Type);

        var list = await owner.GetFromJsonAsync<List<CommentDto>>($"/api/versions/{versionId}/comments");
        Assert.Single(list!);

        var patch = await owner.PatchAsJsonAsync($"/api/comments/{dto.Id}", new { status = "resolved" });
        Assert.Equal(HttpStatusCode.NoContent, patch.StatusCode);
    }

    [SkippableFact]
    public async Task NonOwner_CannotModerateComment()
    {
        await TestDb.RequireAsync(_factory);
        var (owner, _) = await NewAuthedClient();
        var versionId = await CreateVersion(owner);
        var dto = await (await owner.PostAsJsonAsync($"/api/versions/{versionId}/comments",
            new { body = "x" })).Content.ReadFromJsonAsync<CommentDto>();

        var (attacker, _) = await NewAuthedClient();
        var patch = await attacker.PatchAsJsonAsync($"/api/comments/{dto!.Id}", new { status = "hidden" });
        Assert.Equal(HttpStatusCode.Forbidden, patch.StatusCode);
    }

    [SkippableFact]
    public async Task InvitedReviewer_Suggests_OwnerAccepts_ForksRackPreset()
    {
        await TestDb.RequireAsync(_factory);
        var (owner, _) = await NewAuthedClient();
        var versionId = await CreateVersion(owner);
        var (reviewer, reviewerEmail) = await NewAuthedClient();
        await owner.PostAsJsonAsync($"/api/versions/{versionId}/invites",
            new { role = "reviewer", invitedEmail = reviewerEmail });

        var sugg = await (await reviewer.PostAsJsonAsync($"/api/versions/{versionId}/suggestions",
            new { chain = SampleChain() })).Content.ReadFromJsonAsync<SuggestionDto>();
        Assert.Equal("proposed", sugg!.Status);

        // Non-owner cannot accept.
        var reviewerAccept = await reviewer.PostAsync($"/api/suggestions/{sugg.Id}/accept", null);
        Assert.Equal(HttpStatusCode.Forbidden, reviewerAccept.StatusCode);

        // Owner accepts → forks a RackPreset carrying from_suggestion_id.
        var accept = await owner.PostAsync($"/api/suggestions/{sugg.Id}/accept", null);
        Assert.Equal(HttpStatusCode.OK, accept.StatusCode);
        var preset = await accept.Content.ReadFromJsonAsync<RackPresetDto>();
        Assert.Equal(versionId, preset!.SongVersionId);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var forked = await db.RackPresets.AsNoTracking().FirstAsync(p => p.Id == preset.Id);
        Assert.Equal(sugg.Id, forked.FromSuggestionId);
        var refreshed = await db.Suggestions.AsNoTracking().FirstAsync(s => s.Id == sugg.Id);
        Assert.Equal("accepted", refreshed.Status);
    }

    [SkippableFact]
    public async Task Anon_Comment_AllowedUnderLink_BlockedUnderNamed()
    {
        await TestDb.RequireAsync(_factory);
        var (owner, _) = await NewAuthedClient();
        var versionId = await CreateVersion(owner);
        var s = await (await owner.PutAsJsonAsync($"/api/versions/{versionId}/share",
            new { visibility = "unlisted", commentsPolicy = "link" }))
            .Content.ReadFromJsonAsync<ShareSettingsDto>();
        var token = s!.ShareToken!;
        var anon = _factory.CreateClient();

        var ok = await anon.PostAsJsonAsync($"/api/v/{token}/comments", new { body = "nice mix" });
        Assert.Equal(HttpStatusCode.Created, ok.StatusCode);

        // Flip to named → anon can no longer comment.
        await owner.PutAsJsonAsync($"/api/versions/{versionId}/share", new { commentsPolicy = "named" });
        var blocked = await anon.PostAsJsonAsync($"/api/v/{token}/comments", new { body = "blocked?" });
        Assert.Equal(HttpStatusCode.Forbidden, blocked.StatusCode);
    }

    [SkippableFact]
    public async Task ThreeWayCheck_RejectsTwoTargets()
    {
        await TestDb.RequireAsync(_factory);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        db.TrackComments.Add(new TrackComment
        {
            Id = Guid.NewGuid(),
            TargetShareToken = "tok",
            TargetVersionId = Guid.NewGuid(),  // two targets → CHECK violation
            Body = "bad",
        });
        await Assert.ThrowsAnyAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    // ── helpers ──────────────────────────────────────────────────────────────
    private async Task<(HttpClient client, string email)> NewAuthedClient()
    {
        var client = _factory.CreateClient();
        var email = $"fb+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email, password = "correct-horse-battery" });
        reg.EnsureSuccessStatusCode();
        var auth = await reg.Content.ReadFromJsonAsync<AuthResponse>();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", auth!.AccessToken);
        return (client, email);
    }

    private static async Task<Guid> CreateVersion(HttpClient client)
    {
        using var form = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(new byte[512]);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        form.Add(fileContent, "file", "fb-test.wav");
        form.Add(new StringContent("false"), "analyze");
        var resp = await client.PostAsync("/api/versions/", form);
        resp.EnsureSuccessStatusCode();
        return (await resp.Content.ReadFromJsonAsync<UploadResponse>())!.VersionId;
    }

}
