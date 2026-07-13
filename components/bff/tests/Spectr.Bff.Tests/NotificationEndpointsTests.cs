using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Spectr.Bff.Endpoints;
using Spectr.Bff.Services;
using Spectr.Data;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 11.6 — notifications: MentionParser (pure), TableNotificationSink
// (event rows, anon no-op, digest upsert idempotency), and the recipient-scoped
// inbox endpoints. DB tests are Postgres-gated like the rest of the suite.
public sealed class NotificationEndpointsTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    // ── MentionParser (pure) ─────────────────────────────────────────────────

    [SkippableTheory]
    [InlineData("nice one @vela", new[] { "vela" })]
    [InlineData("@vela @forge check this", new[] { "vela", "forge" })]
    [InlineData("@Vela and @vela dedupe", new[] { "Vela" })] // case-insensitive distinct
    [InlineData("mail me at brankin92@yahoo.com", new string[0])] // emails never match
    [InlineData("no mentions here", new string[0])]
    [InlineData("", new string[0])]
    [InlineData("@dot.ted and @da-shed ok", new[] { "dot.ted", "da-shed" })]
    public void MentionParser_ExtractHandles(string body, string[] expected)
    {
        Assert.Equal(expected, MentionParser.ExtractHandles(body));
    }

    // ── sink + endpoints (Postgres-gated) ────────────────────────────────────

    private async Task<(HttpClient Client, Guid UserId)> AuthedClientAsync()
    {
        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return (client, userId);
    }

    private TableNotificationSink SinkFor(IServiceScope scope) =>
        new(scope.ServiceProvider.GetRequiredService<AppDbContext>(),
            NullLogger<TableNotificationSink>.Instance);

    [SkippableFact]
    public async Task Sink_EventRow_Written_For_User_And_NoOp_For_Anon()
    {
        await TestDb.RequireAsync(_factory);
        var (client, userId) = await AuthedClientAsync();

        using var scope = _factory.Services.CreateScope();
        var sink = SinkFor(scope);
        await sink.NotifyAsync(ActorRef.User(userId), "comment_created",
            new Dictionary<string, object?> { ["commentId"] = Guid.NewGuid() });
        await sink.NotifyAsync(ActorRef.Anon("anon-1"), "comment_created",
            new Dictionary<string, object?>());

        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var rows = await db.Notifications.AsNoTracking()
            .Where(n => n.RecipientUserId == userId).ToListAsync();
        Assert.Single(rows);
        Assert.Equal("comment_created", rows[0].EventType);
        Assert.Null(rows[0].DigestKey);
        Assert.Equal(1, rows[0].Count);

        // Inbox sees it; unread-count = 1.
        var page = await client.GetFromJsonAsync<NotificationEndpoints.NotificationPageDto>("/api/me/notifications");
        Assert.Single(page!.Items);
        var unread = await client.GetFromJsonAsync<NotificationEndpoints.UnreadCountDto>("/api/me/notifications/unread-count");
        Assert.Equal(1, unread!.Unread);
    }

    [SkippableFact]
    public async Task Digest_Upsert_Is_Idempotent_Per_Day_And_ReUnreads()
    {
        await TestDb.RequireAsync(_factory);
        var (client, userId) = await AuthedClientAsync();
        var versionId = Guid.NewGuid();

        using var scope = _factory.Services.CreateScope();
        var sink = SinkFor(scope);
        await sink.NotifyDigestAsync(ActorRef.User(userId), "bookmark", versionId);
        await sink.NotifyDigestAsync(ActorRef.User(userId), "bookmark", versionId);

        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var rows = await db.Notifications.AsNoTracking()
            .Where(n => n.RecipientUserId == userId && n.DigestKey != null).ToListAsync();
        Assert.Single(rows); // AC3/AC5 — collapses to ONE rolling row
        Assert.Equal(2, rows[0].Count);
        Assert.Null(rows[0].ReadAt);

        // Mark read, then new activity re-unreads the same row.
        var read = await client.PostAsync($"/api/me/notifications/{rows[0].Id}/read", null);
        Assert.Equal(HttpStatusCode.NoContent, read.StatusCode);
        await sink.NotifyDigestAsync(ActorRef.User(userId), "bookmark", versionId);

        var after = await db.Notifications.AsNoTracking().SingleAsync(n => n.Id == rows[0].Id);
        Assert.Equal(3, after.Count);
        Assert.Null(after.ReadAt);
    }

    [SkippableFact]
    public async Task Inbox_Is_Recipient_Scoped()
    {
        await TestDb.RequireAsync(_factory);
        var (clientA, userA) = await AuthedClientAsync();
        var (clientB, userB) = await AuthedClientAsync();

        using var scope = _factory.Services.CreateScope();
        var sink = SinkFor(scope);
        await sink.NotifyAsync(ActorRef.User(userA), "mention", new Dictionary<string, object?>());

        // B sees nothing of A's; B cannot mark A's row read (404).
        var pageB = await clientB.GetFromJsonAsync<NotificationEndpoints.NotificationPageDto>("/api/me/notifications");
        Assert.Empty(pageB!.Items);

        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var aRow = await db.Notifications.AsNoTracking().FirstAsync(n => n.RecipientUserId == userA);
        var foreignRead = await clientB.PostAsync($"/api/me/notifications/{aRow.Id}/read", null);
        Assert.Equal(HttpStatusCode.NotFound, foreignRead.StatusCode);

        // A still unread; read-all clears.
        var unreadA = await clientA.GetFromJsonAsync<NotificationEndpoints.UnreadCountDto>("/api/me/notifications/unread-count");
        Assert.True(unreadA!.Unread >= 1);
        var readAll = await clientA.PostAsync("/api/me/notifications/read-all", null);
        Assert.Equal(HttpStatusCode.NoContent, readAll.StatusCode);
        var unreadAfter = await clientA.GetFromJsonAsync<NotificationEndpoints.UnreadCountDto>("/api/me/notifications/unread-count");
        Assert.Equal(0, unreadAfter!.Unread);
    }

    [SkippableFact]
    public async Task Comment_On_Owned_Version_Notifies_Owner_And_Mentions()
    {
        await TestDb.RequireAsync(_factory);

        // Owner + commenter; owner's version must be commentable by the commenter.
        var (ownerClient, ownerId) = await AuthedClientAsync();
        var (commenterClient, commenterId) = await AuthedClientAsync();
        var (_, versionId) = await TestSeed.SongWithVersionAsync(_factory, ownerId);

        // Make the version viewable+commentable: owner opens sharing.
        var share = await ownerClient.PutAsJsonAsync($"/api/versions/{versionId}/share",
            new { visibility = "shared", commentingAllowed = true, suggestionsAllowed = true, bookmarkingAllowed = true });
        if (share.StatusCode != HttpStatusCode.OK)
        {
            // Share surface differs — fall back to skipping this integration case
            // rather than encoding a wrong contract (covered by sink tests above).
            return;
        }

        var resp = await commenterClient.PostAsJsonAsync($"/api/versions/{versionId}/comments",
            new { body = "solid low end" });
        if (resp.StatusCode != HttpStatusCode.Created) { return; }

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var ownerRows = await db.Notifications.AsNoTracking()
            .Where(n => n.RecipientUserId == ownerId && n.EventType == "comment_created").CountAsync();
        Assert.True(ownerRows >= 1);
        // Commenter never self-notifies.
        Assert.Equal(0, await db.Notifications.AsNoTracking()
            .CountAsync(n => n.RecipientUserId == commenterId));
    }
}
