using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.DTOs;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Listen V3 (PRP-2) — version sharing + AccessService invariants. Postgres-gated.
// Covers X.1 (coach owner-only), X.2 (Work owner-only), comments_policy, token
// mint/rotate, invites accept/revoke, and the anon /v/{token} entry.
public sealed class VersionShareEndpointsTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    [Fact]
    public async Task Owner_Access_GrantsWorkAndCoach_NotHostableAtLaunch()
    {
        if (!await PostgresReachable()) return;
        var (client, _) = await NewAuthedClient();
        var versionId = await CreateVersion(client);

        var acc = await client.GetFromJsonAsync<AccessDto>($"/api/versions/{versionId}/access");
        Assert.NotNull(acc);
        Assert.Equal("owner", acc!.Role);
        Assert.True(acc.CanWork);          // X.2 — owner only
        Assert.True(acc.CanView);
        Assert.True(acc.CoachAvailable);   // X.1 — owner only
        Assert.False(acc.RoomHostable);    // room_hosting_enabled=false at launch
    }

    [Fact]
    public async Task NonOwner_Access_OnPrivateVersion_IsNone()
    {
        if (!await PostgresReachable()) return;
        var (owner, _) = await NewAuthedClient();
        var versionId = await CreateVersion(owner);

        var (attacker, _) = await NewAuthedClient();
        var acc = await attacker.GetFromJsonAsync<AccessDto>($"/api/versions/{versionId}/access");
        Assert.NotNull(acc);
        Assert.Equal("none", acc!.Role);
        Assert.False(acc.CanView);
        Assert.False(acc.CanWork);
        Assert.False(acc.CoachAvailable);
    }

    [Fact]
    public async Task UpdateShare_LeavingPrivate_MintsToken_AndRotateReplacesIt()
    {
        if (!await PostgresReachable()) return;
        var (client, _) = await NewAuthedClient();
        var versionId = await CreateVersion(client);

        // Staying private mints no token.
        var stayPrivate = await PutShare(client, versionId, new { showVerdicts = true });
        Assert.Equal("private", stayPrivate!.Visibility);
        Assert.Null(stayPrivate.ShareToken);

        // Leaving private lazily mints a token.
        var unlisted = await PutShare(client, versionId, new { visibility = "unlisted" });
        Assert.Equal("unlisted", unlisted!.Visibility);
        Assert.False(string.IsNullOrEmpty(unlisted.ShareToken));

        // Rotate replaces it.
        var rot = await client.PostAsync($"/api/versions/{versionId}/share/rotate", null);
        Assert.Equal(HttpStatusCode.OK, rot.StatusCode);
        var rotated = await rot.Content.ReadFromJsonAsync<RotateTokenResponse>();
        Assert.False(string.IsNullOrEmpty(rotated!.ShareToken));
        Assert.NotEqual(unlisted.ShareToken, rotated.ShareToken);
    }

    [Fact]
    public async Task InvitedReviewer_GetsView_ButNotWorkOrCoach()
    {
        if (!await PostgresReachable()) return;
        var (owner, _) = await NewAuthedClient();
        var versionId = await CreateVersion(owner);
        var (reviewer, reviewerEmail) = await NewAuthedClient();

        // Invite by the reviewer's email → invited_user_id binds at creation.
        var inviteResp = await owner.PostAsJsonAsync($"/api/versions/{versionId}/invites",
            new { role = "reviewer", invitedEmail = reviewerEmail });
        Assert.Equal(HttpStatusCode.Created, inviteResp.StatusCode);

        var acc = await reviewer.GetFromJsonAsync<AccessDto>($"/api/versions/{versionId}/access");
        Assert.Equal("invited", acc!.Role);
        Assert.True(acc.CanView);          // invite is the grant (private is fine)
        Assert.False(acc.CanWork);         // X.2
        Assert.False(acc.CoachAvailable);  // X.1
    }

    [Fact]
    public async Task InviteAccept_BindsUser_AndRevokeRemovesAccess()
    {
        if (!await PostgresReachable()) return;
        var (owner, _) = await NewAuthedClient();
        var versionId = await CreateVersion(owner);
        var (reviewer, _) = await NewAuthedClient();

        // Unbound invite (no matching email) → reviewer binds it by accepting.
        var inviteDto = await (await owner.PostAsJsonAsync($"/api/versions/{versionId}/invites",
            new { role = "reviewer" })).Content.ReadFromJsonAsync<InviteDto>();

        var accept = await reviewer.PostAsync($"/api/invites/{inviteDto!.Token}/accept", null);
        Assert.Equal(HttpStatusCode.OK, accept.StatusCode);
        var accepted = await accept.Content.ReadFromJsonAsync<InviteDto>();
        Assert.Equal("accepted", accepted!.Status);

        var afterAccept = await reviewer.GetFromJsonAsync<AccessDto>($"/api/versions/{versionId}/access");
        Assert.True(afterAccept!.CanView);

        // Revoking the invite removes access.
        var revoke = await owner.DeleteAsync($"/api/invites/{inviteDto.Id}");
        Assert.Equal(HttpStatusCode.NoContent, revoke.StatusCode);
        var afterRevoke = await reviewer.GetFromJsonAsync<AccessDto>($"/api/versions/{versionId}/access");
        Assert.False(afterRevoke!.CanView);
        Assert.Equal("none", afterRevoke.Role);
    }

    [Fact]
    public async Task AnonView_CommentsPolicy_NamedBlocksAnon_LinkAllows()
    {
        if (!await PostgresReachable()) return;
        var (owner, _) = await NewAuthedClient();
        var versionId = await CreateVersion(owner);

        // Share unlisted with named comments → anon cannot comment.
        var s = await PutShare(owner, versionId, new { visibility = "unlisted", commentsPolicy = "named" });
        var token = s!.ShareToken!;
        var anon = _factory.CreateClient();

        var named = await anon.GetFromJsonAsync<VersionViewDto>($"/api/v/{token}");
        Assert.NotNull(named);
        Assert.False(named!.Gates.CanComment);

        // Flip to link comments → anon can comment.
        await PutShare(owner, versionId, new { commentsPolicy = "link" });
        var link = await anon.GetFromJsonAsync<VersionViewDto>($"/api/v/{token}");
        Assert.True(link!.Gates.CanComment);
    }

    [Fact]
    public async Task AnonView_TokenStopsResolving_WhenBackToPrivate()
    {
        if (!await PostgresReachable()) return;
        var (owner, _) = await NewAuthedClient();
        var versionId = await CreateVersion(owner);
        var s = await PutShare(owner, versionId, new { visibility = "unlisted" });
        var token = s!.ShareToken!;

        var anon = _factory.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await anon.GetAsync($"/api/v/{token}")).StatusCode);

        // Back to private → the share token no longer resolves.
        await PutShare(owner, versionId, new { visibility = "private" });
        Assert.Equal(HttpStatusCode.NotFound, (await anon.GetAsync($"/api/v/{token}")).StatusCode);
    }

    // Story 11.11 — /v/{token} carries the owner's public identity for the
    // follow-producer CTA (null when the owner has no handle or is inactive).
    [Fact]
    public async Task VersionView_Carries_Owner_Handle_When_Followable()
    {
        if (!await PostgresReachable()) return;
        var (owner, email) = await NewAuthedClient();
        var versionId = await CreateVersion(owner);
        var s = await PutShare(owner, versionId, new { visibility = "unlisted" });
        var token = s!.ShareToken!;
        var anon = _factory.CreateClient();

        // Registration seeds a handle, so the owner identity is present.
        var handle = $"own{Guid.NewGuid():N}"[..14];
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Spectr.Data.AppDbContext>();
            var user = await db.Users.SingleAsync(u => u.Email == email);
            user.Handle = handle;
            user.DisplayName = "Owner Name";
            await db.SaveChangesAsync();
        }
        var view = await anon.GetFromJsonAsync<VersionViewDto>($"/api/v/{token}");
        Assert.Equal(handle, view!.OwnerHandle);
        Assert.Equal("Owner Name", view.OwnerDisplayName);

        // Deactivated owner → null identity (a /u/{handle} link would 404).
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Spectr.Data.AppDbContext>();
            var user = await db.Users.SingleAsync(u => u.Email == email);
            user.IsActive = false;
            await db.SaveChangesAsync();
        }
        var gone = await anon.GetFromJsonAsync<VersionViewDto>($"/api/v/{token}");
        Assert.Null(gone!.OwnerHandle);
        Assert.Null(gone.OwnerDisplayName);
    }

    // ── helpers ──────────────────────────────────────────────────────────────
    private async Task<(HttpClient client, string email)> NewAuthedClient()
    {
        var client = _factory.CreateClient();
        var email = $"share+{Guid.NewGuid():N}@spectr.test";
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
        form.Add(fileContent, "file", "share-test.wav");
        form.Add(new StringContent("false"), "analyze");
        var resp = await client.PostAsync("/api/versions/", form);
        resp.EnsureSuccessStatusCode();
        return (await resp.Content.ReadFromJsonAsync<UploadResponse>())!.VersionId;
    }

    private static async Task<ShareSettingsDto?> PutShare(HttpClient client, Guid versionId, object body)
    {
        var resp = await client.PutAsJsonAsync($"/api/versions/{versionId}/share", body);
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadFromJsonAsync<ShareSettingsDto>();
    }

    private async Task<bool> PostgresReachable()
    {
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider
                .GetRequiredService<Spectr.Data.AppDbContext>();
            return await db.Database.CanConnectAsync();
        }
        catch { return false; }
    }
}
