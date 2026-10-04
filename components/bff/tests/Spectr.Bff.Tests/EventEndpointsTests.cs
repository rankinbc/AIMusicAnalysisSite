using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.DTOs;
using Spectr.Bff.Endpoints;
using Spectr.Data;
using Spectr.Data.Entities;
using Xunit;

namespace Spectr.Bff.Tests;

// F1b — POST /api/events, the first-party analytics sink: write-only, always
// 204, stores only allowlisted events with sanitized fields.
public sealed class EventEndpointsTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    // ── sanitizers (no DB) ───────────────────────────────────────────────

    [Theory]
    [InlineData("/pricing", "/pricing")]
    [InlineData("/pricing?utm_source=x&ref=jane@x.com", "/pricing")]
    [InlineData("/trust/privacy#top", "/trust/privacy")]
    [InlineData("/songs/3f2504e0-4f89-11d3-9a0c-0305e82c3301/results/3F2504E0-4F89-11D3-9A0C-0305E82C3301",
        "/songs/:id/results/:id")]
    [InlineData("pricing", null)]
    [InlineData("/u/jane@x.com", null)]
    [InlineData("/a b", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void CleanPath_Keeps_A_Bare_Path(string? raw, string? expected) =>
        Assert.Equal(expected, EventEndpoints.CleanPath(raw));

    [Fact]
    public void CleanPath_Is_Capped_At_128() =>
        Assert.Equal(128, EventEndpoints.CleanPath("/" + new string('a', 500))!.Length);

    private static string? Props(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return EventEndpoints.CleanProps(doc.RootElement);
    }

    [Fact]
    public void CleanProps_Keeps_Short_Primitives_And_Drops_Everything_Else()
    {
        var cleaned = Props("""
            {"props":{"product":"credits","pending":true,"count":3,
                      "email":"jane@x.com","nested":{"a":1},"list":[1],
                      "Bad Key":"x","long":"LONGVALUE"}}
            """.Replace("LONGVALUE", new string('x', 200)));
        using var doc = JsonDocument.Parse(cleaned!);
        var keys = doc.RootElement.EnumerateObject().Select(p => p.Name).OrderBy(n => n).ToArray();
        Assert.Equal(["count", "pending", "product"], keys);
        Assert.DoesNotContain("@", cleaned);
    }

    [Fact]
    public void CleanProps_Caps_The_Number_Of_Keys_And_Returns_Null_When_Empty()
    {
        var many = "{\"props\":{" + string.Join(",", Enumerable.Range(0, 30).Select(i => $"\"k{i}\":{i}")) + "}}";
        using var doc = JsonDocument.Parse(Props(many)!);
        Assert.Equal(8, doc.RootElement.EnumerateObject().Count());

        Assert.Null(Props("""{"props":{"email":"a@b.c"}}"""));
        Assert.Null(Props("""{"props":"nope"}"""));
        Assert.Null(Props("""{}"""));
    }

    // ── endpoint ─────────────────────────────────────────────────────────

    private static string NewSession() => Guid.NewGuid().ToString();

    private async Task<List<AnalyticsEvent>> RowsAsync(string sessionId)
    {
        using var scope = factory.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<AppDbContext>()
            .AnalyticsEvents.AsNoTracking().Where(e => e.SessionId == sessionId).ToListAsync();
    }

    private async Task DeleteAsync(string sessionId)
    {
        using var scope = factory.Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<AppDbContext>()
            .AnalyticsEvents.Where(e => e.SessionId == sessionId).ExecuteDeleteAsync();
    }

    [SkippableFact]
    public async Task An_Anonymous_Known_Event_Is_Stored_Sanitized()
    {
        await TestDb.RequireAsync(factory);
        TestDb.Require(TestDb.RedisUp(factory), "Redis");
        var sid = NewSession();
        try
        {
            var resp = await factory.CreateClient().PostAsJsonAsync("/api/events", new
            {
                @event = "pricing_viewed",
                sessionId = sid,
                path = "/pricing?ref=jane@x.com",
                props = new { cadence = "monthly", email = "jane@x.com" },
                attribution = new { source = "YouTube", referrer = "https://www.google.com/search?q=secret" },
            });
            Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
            Assert.Equal("", await resp.Content.ReadAsStringAsync());

            var row = Assert.Single(await RowsAsync(sid));
            Assert.Equal("pricing_viewed", row.Event);
            Assert.Null(row.UserId);
            Assert.Equal("/pricing", row.Path);
            Assert.Equal("youtube", row.Source);
            Assert.Equal("www.google.com", row.Referrer);
            Assert.Contains("monthly", row.Props);
            Assert.DoesNotContain("jane", row.Props);
        }
        finally { await DeleteAsync(sid); }
    }

    [SkippableFact]
    public async Task A_Signed_In_Caller_Is_Stamped_With_Their_User_Id()
    {
        await TestDb.RequireAsync(factory);
        TestDb.Require(TestDb.RedisUp(factory), "Redis");
        var sid = NewSession();
        Guid userId = default;
        try
        {
            var client = factory.CreateClient();
            var reg = await client.PostAsJsonAsync("/api/auth/register",
                new { email = $"events+{Guid.NewGuid():N}@spectr.test", password = "correct-horse-battery" });
            reg.EnsureSuccessStatusCode();
            var auth = (await reg.Content.ReadFromJsonAsync<AuthResponse>())!;
            userId = auth.User.Id;
            client.DefaultRequestHeaders.Authorization = new("Bearer", auth.AccessToken);

            var resp = await client.PostAsJsonAsync("/api/events",
                new { @event = "report_viewed", sessionId = sid, path = "/library" });
            Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
            Assert.Equal(userId, Assert.Single(await RowsAsync(sid)).UserId);
        }
        finally
        {
            await DeleteAsync(sid);
            await DemoAuthEndpointsTests.CleanupAsync(factory, userId);
        }
    }

    [SkippableTheory]
    [InlineData("""{"event":"totally_made_up","sessionId":"SID"}""")]
    [InlineData("""{"sessionId":"SID"}""")]
    [InlineData("""{ not json""")]
    [InlineData("""["event","landing_viewed"]""")]
    public async Task Unknown_Or_Malformed_Bodies_Are_A_Silent_No_Op(string template)
    {
        await TestDb.RequireAsync(factory);
        TestDb.Require(TestDb.RedisUp(factory), "Redis");
        var sid = NewSession();
        var resp = await factory.CreateClient().PostAsync("/api/events",
            new StringContent(template.Replace("SID", sid), Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        Assert.Empty(await RowsAsync(sid));
    }

    [SkippableFact]
    public async Task An_Oversized_Body_Is_Dropped()
    {
        await TestDb.RequireAsync(factory);
        TestDb.Require(TestDb.RedisUp(factory), "Redis");
        var sid = NewSession();
        var body = JsonSerializer.Serialize(new
        { @event = "landing_viewed", sessionId = sid, path = "/" + new string('a', 6000) });
        var resp = await factory.CreateClient().PostAsync("/api/events",
            new StringContent(body, Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        Assert.Empty(await RowsAsync(sid));
    }

    [SkippableFact]
    public async Task A_Bad_Session_Id_Is_Not_Stored()
    {
        await TestDb.RequireAsync(factory);
        TestDb.Require(TestDb.RedisUp(factory), "Redis");
        var marker = $"/t/{Guid.NewGuid():N}";
        try
        {
            var resp = await factory.CreateClient().PostAsJsonAsync("/api/events",
                new { @event = "landing_viewed", sessionId = "jane@x.com", path = marker });
            Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var row = await db.AnalyticsEvents.AsNoTracking().SingleAsync(e => e.Path == marker);
            Assert.Null(row.SessionId);
        }
        finally
        {
            using var scope = factory.Services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<AppDbContext>()
                .AnalyticsEvents.Where(e => e.Path == marker).ExecuteDeleteAsync();
        }
    }
}
