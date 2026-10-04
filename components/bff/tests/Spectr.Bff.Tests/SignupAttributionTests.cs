using System.Net;
using System.Net.Http.Json;
using System.Text;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using Xunit;

namespace Spectr.Bff.Tests;

// F1 (analytics + attribution) — first-touch source on the users row.
// Pure sanitizer tests first; then the three account-creating endpoints
// (register, guest mint, guest convert). Shares the "DemoAuth" collection
// because it mints guest rows (see DemoAuthEndpointsTests).
[Collection("DemoAuth")]
public sealed class SignupAttributionTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    // ── sanitizer (no DB) ────────────────────────────────────────────────

    [Theory]
    [InlineData("YouTube", "youtube")]
    [InlineData("launch_oct-2026", "launch_oct-2026")]
    [InlineData("Jane.Doe@X.com <script>", "janedoexcomscript")]
    [InlineData("!!!", null)]
    [InlineData("   ", null)]
    [InlineData(null, null)]
    public void Slug_Keeps_Only_Slug_Characters(string? raw, string? expected) =>
        Assert.Equal(expected, SignupAttributionWriter.Slug(raw));

    [Fact]
    public void Slug_Is_Capped_At_64() =>
        Assert.Equal(64, SignupAttributionWriter.Slug(new string('a', 500))!.Length);

    [Theory]
    [InlineData("www.Google.com", "www.google.com")]
    [InlineData("https://www.google.com/search?q=secret+terms", "www.google.com")]
    [InlineData("https://user:pw@evil.example/path", "evil.example")]
    [InlineData("jane@x.com", null)]
    [InlineData("has space.com", null)]
    [InlineData("spectrmix.com", null)] // the site itself is not a referrer
    [InlineData("", null)]
    public void Host_Reduces_To_A_Bare_Host(string raw, string? expected) =>
        Assert.Equal(expected, SignupAttributionWriter.Host(raw, "spectrmix.com"));

    [Fact]
    public void Host_Rejects_An_Overlong_Value() =>
        Assert.Null(SignupAttributionWriter.Host(new string('a', 200) + ".com", null));

    [Fact]
    public void Apply_Fills_Nulls_Only_First_Touch_Wins()
    {
        var user = new User { Email = "a@spectr.test", HashedPassword = "x", SignupSource = "first" };
        SignupAttributionWriter.Apply(
            user, new SignupAttribution("second", "Email", null, "https://news.example/a?b=c"), "spectrmix.com");
        Assert.Equal("first", user.SignupSource);
        Assert.Equal("email", user.SignupMedium);
        Assert.Null(user.SignupCampaign);
        Assert.Equal("news.example", user.SignupReferrer);
    }

    [Fact]
    public void Clean_Returns_Null_When_Nothing_Usable_Remains()
    {
        Assert.Null(SignupAttributionWriter.Clean(null, null));
        Assert.Null(SignupAttributionWriter.Clean(new SignupAttribution("!!!", "", null, "a b"), null));
    }

    // ── endpoints ────────────────────────────────────────────────────────

    private WebApplicationFactory<Program> Build(Action<IWebHostBuilder>? extra = null) =>
        DemoAuthEndpointsTests.BuildFactory(factory, new DemoAuthEndpointsTests.RecordingJobQueue(), extra);

    private static async Task<User> UserAsync(WebApplicationFactory<Program> f, Guid id)
    {
        using var scope = f.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<AppDbContext>()
            .Users.AsNoTracking().SingleAsync(u => u.Id == id);
    }

    private static async Task<Guid> UserIdByEmailAsync(WebApplicationFactory<Program> f, string email)
    {
        using var scope = f.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<AppDbContext>()
            .Users.Where(u => u.Email == email).Select(u => u.Id).SingleAsync();
    }

    [SkippableFact]
    public async Task Register_Persists_Sanitized_Attribution()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        Guid userId = default;
        try
        {
            var resp = await f.CreateClient().PostAsJsonAsync("/api/auth/register", new
            {
                email = $"attr+{Guid.NewGuid():N}@spectr.test",
                password = "correct-horse-battery",
                attribution = new
                {
                    source = "Jane@X.com",
                    medium = new string('m', 500),
                    campaign = "Launch_Oct",
                    referrer = "https://www.google.com/search?q=secret",
                },
            });
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            userId = (await resp.Content.ReadFromJsonAsync<AuthResponse>())!.User.Id;

            var u = await UserAsync(f, userId);
            Assert.Equal("janexcom", u.SignupSource);
            Assert.Equal(new string('m', 64), u.SignupMedium);
            Assert.Equal("launch_oct", u.SignupCampaign);
            Assert.Equal("www.google.com", u.SignupReferrer);
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task Register_Without_Attribution_Leaves_Nulls()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        Guid userId = default;
        try
        {
            var resp = await f.CreateClient().PostAsJsonAsync("/api/auth/register",
                new { email = $"attr+{Guid.NewGuid():N}@spectr.test", password = "correct-horse-battery" });
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            userId = (await resp.Content.ReadFromJsonAsync<AuthResponse>())!.User.Id;

            var u = await UserAsync(f, userId);
            Assert.Null(u.SignupSource); Assert.Null(u.SignupMedium);
            Assert.Null(u.SignupCampaign); Assert.Null(u.SignupReferrer);
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task Re_Registering_A_Pending_Address_Does_Not_Overwrite_The_First_Source()
    {
        await TestDb.RequireAsync(factory);
        TestDb.Require(TestDb.RedisUp(factory), "Redis");
        var f = Build(b => b.UseSetting("Auth:DevAutoVerify", "false"));
        Guid userId = default;
        try
        {
            var client = f.CreateClient();
            var email = $"attr+{Guid.NewGuid():N}@spectr.test";
            var first = await client.PostAsJsonAsync("/api/auth/register", new
            { email, password = "correct-horse-battery", attribution = new { source = "first" } });
            Assert.Equal(HttpStatusCode.Accepted, first.StatusCode);
            userId = await UserIdByEmailAsync(f, email);

            var second = await client.PostAsJsonAsync("/api/auth/register", new
            {
                email, password = "another-horse-battery",
                attribution = new { source = "second", campaign = "late" },
            });
            Assert.Equal(HttpStatusCode.Accepted, second.StatusCode);

            var u = await UserAsync(f, userId);
            Assert.Equal("first", u.SignupSource);
            Assert.Equal("late", u.SignupCampaign); // was null, so it is filled
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task Guest_Mint_Stores_Attribution_And_A_Resumed_Guest_Is_Unchanged()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        Guid userId = default;
        try
        {
            var client = f.CreateClient();
            var resp = await client.PostAsJsonAsync("/api/auth/demo",
                new { attribution = new { source = "youtube", medium = "video" } });
            resp.EnsureSuccessStatusCode();
            var demo = (await resp.Content.ReadFromJsonAsync<DemoStartResponse>())!;
            userId = demo.User.Id;

            var u = await UserAsync(f, userId);
            Assert.Equal("youtube", u.SignupSource);
            Assert.Equal("video", u.SignupMedium);

            // Same device, different link: the SAME guest resumes, source intact.
            var again = new HttpRequestMessage(HttpMethod.Post, "/api/auth/demo")
            { Content = JsonContent.Create(new { attribution = new { source = "tiktok" } }) };
            again.Headers.Add("Cookie", DemoAuthEndpointsTests.DeviceCookie(resp));
            var resumed = (await (await f.CreateClient().SendAsync(again))
                .Content.ReadFromJsonAsync<DemoStartResponse>())!;
            Assert.True(resumed.Resumed);
            Assert.Equal(userId, resumed.User.Id);
            Assert.Equal("youtube", (await UserAsync(f, userId)).SignupSource);
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    [SkippableTheory]
    [InlineData("{ not json")]
    [InlineData("\"just a string\"")]
    [InlineData("{\"attribution\":\"nope\"}")]
    public async Task Guest_Mint_Survives_A_Malformed_Body(string body)
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        Guid userId = default;
        try
        {
            var resp = await f.CreateClient().PostAsync("/api/auth/demo",
                new StringContent(body, Encoding.UTF8, "application/json"));
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            userId = (await resp.Content.ReadFromJsonAsync<DemoStartResponse>())!.User.Id;
            Assert.Null((await UserAsync(f, userId)).SignupSource);
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task Guest_Convert_Keeps_The_Mint_Source_And_Fills_Only_Nulls()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        Guid userId = default;
        try
        {
            var client = f.CreateClient();
            var resp = await client.PostAsJsonAsync("/api/auth/demo",
                new { attribution = new { source = "youtube" } });
            resp.EnsureSuccessStatusCode();
            var demo = (await resp.Content.ReadFromJsonAsync<DemoStartResponse>())!;
            userId = demo.User.Id;
            client.DefaultRequestHeaders.Authorization = new("Bearer", demo.AccessToken);

            var convert = await client.PostAsJsonAsync("/api/auth/guest/convert", new
            {
                email = $"attr+{Guid.NewGuid():N}@spectr.test",
                password = "correct-horse-battery",
                attribution = new { source = "newsletter", medium = "email" },
            });
            Assert.Equal(HttpStatusCode.OK, convert.StatusCode);

            var u = await UserAsync(f, userId);
            Assert.False(u.IsGuest);
            Assert.Equal("youtube", u.SignupSource); // mint-time source survives
            Assert.Equal("email", u.SignupMedium);   // was null, so it is filled
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }
}
