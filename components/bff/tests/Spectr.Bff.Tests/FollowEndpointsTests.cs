using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Data;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 11.9 — follow graph: idempotent follow, unfollow, counts, no self-follow.
public sealed class FollowEndpointsTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private async Task<(HttpClient Client, Guid UserId, string Handle)> AuthedWithHandleAsync()
    {
        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var handle = $"fol{Guid.NewGuid():N}"[..14];
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = await db.Users.SingleAsync(u => u.Id == userId);
        user.Handle = handle;
        await db.SaveChangesAsync();
        return (client, userId, handle);
    }

    private static async Task<JsonElement> State(HttpClient c, string handle)
    {
        var resp = await c.GetAsync($"/api/u/{handle}/follow/");
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadFromJsonAsync<JsonElement>();
    }

    [SkippableFact]
    public async Task Follow_Is_Idempotent_And_Counts_Update()
    {
        await TestDb.RequireAsync(_factory);

        var (alice, _, aliceHandle) = await AuthedWithHandleAsync();
        var (bob, _, bobHandle) = await AuthedWithHandleAsync();

        // Bob follows Alice — twice; second call is a no-op success (AC1).
        Assert.Equal(HttpStatusCode.NoContent, (await bob.PutAsync($"/api/u/{aliceHandle}/follow/", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await bob.PutAsync($"/api/u/{aliceHandle}/follow/", null)).StatusCode);

        var aliceState = await State(bob, aliceHandle);
        Assert.Equal(1, aliceState.GetProperty("followers").GetInt32()); // no duplicate row
        Assert.True(aliceState.GetProperty("isFollowing").GetBoolean());

        var bobState = await State(bob, bobHandle);
        Assert.Equal(1, bobState.GetProperty("following").GetInt32());
        Assert.True(bobState.GetProperty("isSelf").GetBoolean());

        // Unfollow — counts drop; repeat unfollow stays 204 (AC2).
        Assert.Equal(HttpStatusCode.NoContent, (await bob.DeleteAsync($"/api/u/{aliceHandle}/follow/")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await bob.DeleteAsync($"/api/u/{aliceHandle}/follow/")).StatusCode);
        var after = await State(bob, aliceHandle);
        Assert.Equal(0, after.GetProperty("followers").GetInt32());
        Assert.False(after.GetProperty("isFollowing").GetBoolean());
        _ = alice; // silence unused — alice exists to own the followee handle
    }

    [SkippableFact]
    public async Task Self_Follow_Rejected_And_Writes_Require_Auth()
    {
        await TestDb.RequireAsync(_factory);

        var (alice, _, aliceHandle) = await AuthedWithHandleAsync();
        var self = await alice.PutAsync($"/api/u/{aliceHandle}/follow/", null);
        Assert.Equal(HttpStatusCode.BadRequest, self.StatusCode); // AC4

        var anon = _factory.CreateClient();
        var unauthed = await anon.PutAsync($"/api/u/{aliceHandle}/follow/", null);
        Assert.Equal(HttpStatusCode.Unauthorized, unauthed.StatusCode); // AC5

        // Counts read stays public.
        var pub = await anon.GetAsync($"/api/u/{aliceHandle}/follow/");
        Assert.Equal(HttpStatusCode.OK, pub.StatusCode);
    }
}
