using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Xunit;

namespace Spectr.Bff.Tests;

// Task D5 — POST /api/auth/demo: isolated guest sandbox, resume-by-device,
// fail-closed limiter/flags/daily-cap, guest-token expiry, and the guard
// edits to login/register/forgot-password (spec D1/D2/D3, §5).
public sealed class DemoAuthEndpointsTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private sealed class NoOpJobQueue : IJobQueue
    {
        public Task EnqueueAsync(string t, object[] a, CancellationToken ct = default) => Task.CompletedTask;
        public Task EnqueueAsync(string t, object[] a, string q, CancellationToken ct = default) => Task.CompletedTask;
        public Task EnqueueDelayedAsync(string t, object[] a, string q, TimeSpan d, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class ThrowingLimiter : IRateLimiter
    {
        public Task<RateLimitResult> CheckAsync(
            string actorKey, string ip, string action, int limit, TimeSpan window, CancellationToken ct = default)
            => throw new InvalidOperationException("limiter unavailable (test double)");
    }

    private WebApplicationFactory<Program> Build(Action<IWebHostBuilder>? extra = null) =>
        factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Demo:Enabled", "true");
            b.UseSetting("Demo:SnapshotKey", "");
            b.ConfigureTestServices(s =>
            {
                s.RemoveAll(typeof(IJobQueue));
                s.AddSingleton<IJobQueue>(new NoOpJobQueue());
            });
            extra?.Invoke(b);
        });

    private static async Task<string?> Code(HttpResponseMessage resp)
    {
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("error").GetProperty("code").GetString();
    }

    private static string DeviceCookie(HttpResponseMessage resp) =>
        resp.Headers.GetValues("Set-Cookie")
            .First(c => c.StartsWith("spectr_device=", StringComparison.Ordinal))
            .Split(';')[0];

    private async Task CleanupAsync(WebApplicationFactory<Program> f, params Guid[] userIds)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await TestAuth.AllowPurgeAsync(db);
        foreach (var userId in userIds.Where(id => id != default).Distinct())
        {
            var analysisIds = await db.Analyses.Where(a => a.UserId == userId).Select(a => a.Id).ToListAsync();
            await db.Verdicts.Where(v => analysisIds.Contains(v.AnalysisId)).ExecuteDeleteAsync();
            var convoIds = await db.Conversations.Where(c => c.UserId == userId).Select(c => c.Id).ToListAsync();
            await db.CoachMessages.Where(m => convoIds.Contains(m.ConversationId)).ExecuteDeleteAsync();
            await db.Conversations.Where(c => c.UserId == userId).ExecuteDeleteAsync();
            await db.Analyses.Where(a => a.UserId == userId).ExecuteDeleteAsync();
            await db.AnalysisJobs.Where(j => j.UserId == userId).ExecuteDeleteAsync();
            var songIds = await db.Songs.Where(s => s.UserId == userId).Select(s => s.Id).ToListAsync();
            var versionIds = await db.SongVersions.Where(v => songIds.Contains(v.SongId)).Select(v => v.Id).ToListAsync();
            await db.RackPresets.Where(p => versionIds.Contains(p.SongVersionId)).ExecuteDeleteAsync();
            await db.SongVersions.Where(v => songIds.Contains(v.SongId)).ExecuteDeleteAsync();
            await db.Songs.Where(s => s.UserId == userId).ExecuteDeleteAsync();
            await db.RefreshTokens.Where(t => t.UserId == userId).ExecuteDeleteAsync();
            var guestDeviceId = await db.Users.Where(u => u.Id == userId).Select(u => u.GuestDeviceId).SingleOrDefaultAsync();
            await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
            if (guestDeviceId is not null)
                await db.Devices.Where(d => d.Id == guestDeviceId).ExecuteDeleteAsync();
        }
    }

    [SkippableFact]
    public async Task Start_Creates_An_Isolated_Guest_With_A_Seeded_Demo()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        var client = f.CreateClient();
        Guid userId = default;
        try
        {
            var resp = await client.PostAsync("/api/auth/demo", null);
            resp.EnsureSuccessStatusCode();
            var body = await resp.Content.ReadFromJsonAsync<DemoStartResponse>();
            userId = body!.User.Id;
            Assert.True(body.User.IsGuest);
            Assert.False(body.Resumed);
            Assert.EndsWith("@guest.spectr.invalid", body.User.Email);
            client.DefaultRequestHeaders.Authorization = new("Bearer", body.AccessToken);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/api/jobs/{body.Demo.JobId}/results")).StatusCode);
            var audio = await client.GetAsync($"/api/versions/{body.Demo.VersionId}/audio");
            Assert.True(audio.StatusCode is HttpStatusCode.OK or HttpStatusCode.PartialContent);
            Assert.Contains(resp.Headers.GetValues("Set-Cookie"), c => c.StartsWith("spectr_refresh="));
        }
        finally { await CleanupAsync(f, userId); }
    }

    [SkippableFact]
    public async Task The_Same_Device_Resumes_The_Same_Sandbox()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        var client = f.CreateClient();
        Guid userId = default;
        try
        {
            var first = await client.PostAsync("/api/auth/demo", null);
            var a = await first.Content.ReadFromJsonAsync<DemoStartResponse>();
            userId = a!.User.Id;
            var req = new HttpRequestMessage(HttpMethod.Post, "/api/auth/demo");
            req.Headers.Add("Cookie", DeviceCookie(first));
            var b = await (await client.SendAsync(req)).Content.ReadFromJsonAsync<DemoStartResponse>();
            Assert.Equal(a.User.Id, b!.User.Id);
            Assert.True(b.Resumed);
            Assert.Equal(a.Demo, b.Demo);
        }
        finally { await CleanupAsync(f, userId); }
    }

    [SkippableFact]
    public async Task An_Expired_Guest_Gets_A_New_Sandbox()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        var client = f.CreateClient();
        Guid userIdA = default, userIdB = default;
        try
        {
            var first = await client.PostAsync("/api/auth/demo", null);
            var a = await first.Content.ReadFromJsonAsync<DemoStartResponse>();
            userIdA = a!.User.Id;
            using (var scope = f.Services.CreateScope())
                await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.Where(u => u.Id == a.User.Id)
                    .ExecuteUpdateAsync(s => s.SetProperty(u => u.GuestExpiresAt, DateTimeOffset.UtcNow.AddMinutes(-1)));
            var req = new HttpRequestMessage(HttpMethod.Post, "/api/auth/demo");
            req.Headers.Add("Cookie", DeviceCookie(first));
            var b = await (await client.SendAsync(req)).Content.ReadFromJsonAsync<DemoStartResponse>();
            userIdB = b!.User.Id;
            Assert.NotEqual(a.User.Id, b.User.Id);
            Assert.False(b.Resumed);
        }
        finally { await CleanupAsync(f, userIdA, userIdB); }
    }

    [SkippableFact]
    public async Task An_Expired_Guest_Token_Stops_Working()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        var client = f.CreateClient();
        Guid userId = default;
        try
        {
            var g = await (await client.PostAsync("/api/auth/demo", null)).Content.ReadFromJsonAsync<DemoStartResponse>();
            userId = g!.User.Id;
            client.DefaultRequestHeaders.Authorization = new("Bearer", g.AccessToken);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/songs/")).StatusCode);
            using (var scope = f.Services.CreateScope())
            {
                await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.Where(u => u.Id == g.User.Id)
                    .ExecuteUpdateAsync(s => s.SetProperty(u => u.GuestExpiresAt, DateTimeOffset.UtcNow.AddMinutes(-1)));
                scope.ServiceProvider.GetRequiredService<IMemoryCache>().Remove($"tver:{g.User.Id:N}");
            }
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/songs/")).StatusCode);
        }
        finally { await CleanupAsync(f, userId); }
    }

    [SkippableFact]
    public async Task Disabled_Demo_Returns_503_Unavailable()
    {
        await TestDb.RequireAsync(factory);
        var r = await Build(b => b.UseSetting("Demo:Enabled", "false")).CreateClient().PostAsync("/api/auth/demo", null);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, r.StatusCode);
        Assert.Equal("demo_unavailable", await Code(r));
    }

    [SkippableFact]
    public async Task A_Limiter_Failure_Fails_CLOSED()
    {
        await TestDb.RequireAsync(factory);
        var f = Build(b => b.UseSetting("RateLimits:Enabled", "true")
            .ConfigureTestServices(s => { s.RemoveAll(typeof(IRateLimiter)); s.AddSingleton<IRateLimiter>(new ThrowingLimiter()); }));
        var r = await f.CreateClient().PostAsync("/api/auth/demo", null);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, r.StatusCode);
        Assert.Equal("demo_unavailable", await Code(r));
    }

    [SkippableFact]
    public async Task The_Daily_Cap_Returns_503_Capacity()
    {
        await TestDb.RequireAsync(factory);
        var r = await Build(b => b.UseSetting("Demo:DailyCap", "0")).CreateClient().PostAsync("/api/auth/demo", null);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, r.StatusCode);
        Assert.Equal("demo_capacity", await Code(r));
    }

    [SkippableFact]
    public async Task A_Guest_Cannot_Log_In_And_The_Domain_Cannot_Be_Registered()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        var client = f.CreateClient();
        Guid userId = default;
        try
        {
            var g = await (await client.PostAsync("/api/auth/demo", null)).Content.ReadFromJsonAsync<DemoStartResponse>();
            userId = g!.User.Id;
            var login = await client.PostAsJsonAsync("/api/auth/login", new { email = g.User.Email, password = "anything-at-all" });
            Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);
            var reg = await client.PostAsJsonAsync("/api/auth/register", new { email = "x@guest.spectr.invalid", password = TestAuth.Password });
            Assert.Equal(HttpStatusCode.BadRequest, reg.StatusCode);
        }
        finally { await CleanupAsync(f, userId); }
    }

    [SkippableFact]
    public async Task Guests_Cannot_See_Each_Other()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        Guid userIdA = default, userIdB = default;
        try
        {
            var a = await (await f.CreateClient().PostAsync("/api/auth/demo", null)).Content.ReadFromJsonAsync<DemoStartResponse>();
            userIdA = a!.User.Id;
            var bClient = f.CreateClient();
            var b = await (await bClient.PostAsync("/api/auth/demo", null)).Content.ReadFromJsonAsync<DemoStartResponse>();
            userIdB = b!.User.Id;
            bClient.DefaultRequestHeaders.Authorization = new("Bearer", b.AccessToken);
            foreach (var url in new[]
                     {
                         $"/api/jobs/{a.Demo.JobId}/results", $"/api/versions/{a.Demo.VersionId}/audio",
                         $"/api/reports/{a.Demo.JobId}/verdicts/",
                     })
                Assert.Equal(HttpStatusCode.NotFound, (await bClient.GetAsync(url)).StatusCode);
        }
        finally { await CleanupAsync(f, userIdA, userIdB); }
    }

    [SkippableFact]
    public async Task Refresh_Keeps_The_Guest_Flag_And_Caps_The_Cookie()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        var client = f.CreateClient();
        Guid userId = default;
        try
        {
            var start = await client.PostAsync("/api/auth/demo", null);
            var g = await start.Content.ReadFromJsonAsync<DemoStartResponse>();
            userId = g!.User.Id;
            var cookie = start.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith("spectr_refresh=")).Split(';')[0];
            var req = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
            req.Headers.Add("Cookie", cookie);
            var resp = await client.SendAsync(req);
            resp.EnsureSuccessStatusCode();
            Assert.True((await resp.Content.ReadFromJsonAsync<AuthResponse>())!.User.IsGuest);
            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var expires = await db.Users.Where(u => u.Id == g.User.Id).Select(u => u.GuestExpiresAt).SingleAsync();
            Assert.All(await db.RefreshTokens.AsNoTracking().Where(t => t.UserId == g.User.Id).ToListAsync(),
                t => Assert.True(t.ExpiresAt <= expires));
        }
        finally { await CleanupAsync(f, userId); }
    }
}
