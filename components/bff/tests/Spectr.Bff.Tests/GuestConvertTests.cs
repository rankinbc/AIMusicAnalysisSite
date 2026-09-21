using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Xunit;

namespace Spectr.Bff.Tests;

// Task G2 (spec G-D4) — a guest who creates an account keeps the SAME users
// row: same id, songs, analyses, coach conversation, rack presets. Shares
// the "DemoAuth" collection with the other demo-auth suites (GuestCapsTests,
// GuestPurgeTests, GuestGuardInventoryTests, DemoAuthEndpointsTests) — they
// all read/count the SHARED users.is_guest rows and must not run in
// parallel with each other.
[Collection("DemoAuth")]
public sealed class GuestConvertTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private sealed class RecordingQueue : IJobQueue
    {
        public readonly List<(string Task, string Queue)> Sent = [];
        public Task EnqueueAsync(string t, object[] a, CancellationToken ct = default)
        { Sent.Add((t, "")); return Task.CompletedTask; }
        public Task EnqueueAsync(string t, object[] a, string q, CancellationToken ct = default)
        { Sent.Add((t, q)); return Task.CompletedTask; }
        public Task EnqueueDelayedAsync(string t, object[] a, string q, TimeSpan d, CancellationToken ct = default)
        { Sent.Add((t, q)); return Task.CompletedTask; }
    }

    // rateLimits defaults OFF, matching Development's ambient default
    // (GuestCapsTests precedent) — the tests here exercise conversion logic,
    // not the shared rate-limiter arms.
    private WebApplicationFactory<Program> Build(RecordingQueue? queue = null) =>
        factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Demo:Enabled", "true");
            b.UseSetting("Demo:SnapshotKey", "");
            b.ConfigureTestServices(s =>
            {
                s.RemoveAll(typeof(IJobQueue));
                s.AddSingleton<IJobQueue>(queue ?? new RecordingQueue());
            });
        });

    private static async Task<(HttpClient Client, DemoStartResponse Demo)> StartGuestAsync(WebApplicationFactory<Program> f)
    {
        var client = f.CreateClient();
        var resp = await client.PostAsync("/api/auth/demo", null);
        resp.EnsureSuccessStatusCode();
        var body = (await resp.Content.ReadFromJsonAsync<DemoStartResponse>())!;
        client.DefaultRequestHeaders.Authorization = new("Bearer", body.AccessToken);
        return (client, body);
    }

    private static async Task<(HttpClient Client, Guid UserId)> RegisterRealUserAsync(WebApplicationFactory<Program> f)
    {
        var client = f.CreateClient();
        var email = $"guestconvert+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync("/api/auth/register", new { email, password = "correct-horse-battery" });
        reg.EnsureSuccessStatusCode();
        var auth = await reg.Content.ReadFromJsonAsync<AuthResponse>();
        client.DefaultRequestHeaders.Authorization = new("Bearer", auth!.AccessToken);
        return (client, auth.User.Id);
    }

    private static object Body(string? email = null) =>
        new { email = email ?? $"convert+{Guid.NewGuid():N}@spectr.test", password = "correct-horse-battery" };

    [SkippableFact]
    public async Task A_Guest_Becomes_A_Real_Account_On_The_Same_Row_And_Keeps_Their_Songs()
    {
        await TestDb.RequireAsync(factory);
        using var f = Build(); var (client, demo) = await StartGuestAsync(f);
        var email = $"convert+{Guid.NewGuid():N}@spectr.test";
        var oldToken = client.DefaultRequestHeaders.Authorization!.Parameter!;

        var resp = await client.PostAsJsonAsync("/api/auth/guest/convert", Body(email));
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var auth = (await resp.Content.ReadFromJsonAsync<AuthResponse>())!;
        Assert.Equal(demo.User.Id, auth.User.Id);          // SAME row
        Assert.False(auth.User.IsGuest);
        Assert.Equal(email, auth.User.Email);

        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var u = await db.Users.AsNoTracking().SingleAsync(x => x.Id == demo.User.Id);
            Assert.False(u.IsGuest); Assert.Null(u.GuestExpiresAt); Assert.Null(u.GuestDeviceId);
            Assert.True(await db.Songs.AnyAsync(s => s.UserId == u.Id && s.Id == demo.Demo.SongId)); // work kept
            Assert.Equal(1, await db.AuditLogs.CountAsync(a => a.Target == u.Id.ToString() && a.Action == "guest_converted"));
            Assert.Equal(1, await db.RefreshTokens.CountAsync(t => t.UserId == u.Id));               // old guest row gone
        }

        // The guest token is dead (version bumped); the new one is a full account.
        var stale = f.CreateClient(); stale.DefaultRequestHeaders.Authorization = new("Bearer", oldToken);
        Assert.Equal(HttpStatusCode.Unauthorized, (await stale.GetAsync("/api/auth/me")).StatusCode);
        var fresh = f.CreateClient(); fresh.DefaultRequestHeaders.Authorization = new("Bearer", auth.AccessToken);
        var export = await fresh.GetAsync("/api/me/export");
        Assert.NotEqual(HttpStatusCode.Forbidden, export.StatusCode);   // no longer fenced

        // Normal refresh lifetime: the literal Set-Cookie Expires is far beyond the guest's 24 h.
        var setCookie = resp.Headers.GetValues("Set-Cookie").Single(h => h.StartsWith(RefreshTokenService.CookieName + "="));
        var expires = DateTimeOffset.Parse(setCookie.Split(';').Select(p => p.Trim())
            .Single(p => p.StartsWith("expires=", StringComparison.OrdinalIgnoreCase))["expires=".Length..]);
        Assert.True(expires > DateTimeOffset.UtcNow.AddDays(2));
    }

    [SkippableFact]
    public async Task An_Email_That_Exists_Leaves_The_Guest_Untouched()
    {
        await TestDb.RequireAsync(factory);
        using var f = Build();
        var taken = $"taken+{Guid.NewGuid():N}@spectr.test";
        (await f.CreateClient().PostAsJsonAsync("/api/auth/register", Body(taken))).EnsureSuccessStatusCode();
        var (client, demo) = await StartGuestAsync(f);
        var resp = await client.PostAsJsonAsync("/api/auth/guest/convert", Body(taken));
        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        using var scope = f.Services.CreateScope();
        var u = await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.AsNoTracking().SingleAsync(x => x.Id == demo.User.Id);
        Assert.True(u.IsGuest); Assert.NotNull(u.GuestExpiresAt);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/me/guest")).StatusCode); // session still works
    }

    [SkippableFact]
    public async Task A_Real_User_Cannot_Call_It()
    {
        await TestDb.RequireAsync(factory);
        using var f = Build(); var (client, _) = await RegisterRealUserAsync(f);
        var resp = await client.PostAsJsonAsync("/api/auth/guest/convert", Body());
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
        Assert.Equal("not_a_guest", (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetProperty("code").GetString());
    }

    [SkippableFact]
    public async Task The_Reserved_Guest_Domain_Is_Refused()
    {
        await TestDb.RequireAsync(factory);
        using var f = Build(); var (client, _) = await StartGuestAsync(f);
        var resp = await client.PostAsJsonAsync("/api/auth/guest/convert", Body("me@guest.spectr.invalid"));
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [SkippableFact]
    public async Task An_Expired_Guest_Cannot_Be_Resurrected()
    {
        await TestDb.RequireAsync(factory);
        using var f = Build(); var (_, demo) = await StartGuestAsync(f);
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Users.Where(u => u.Id == demo.User.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.GuestExpiresAt, DateTimeOffset.UtcNow.AddMinutes(-1)));
        var rows = await GuestConversion.TryConvertAsync(db, demo.User.Id, $"late+{Guid.NewGuid():N}@spectr.test",
            "hash", "late", autoVerify: false, DateTimeOffset.UtcNow, default);
        Assert.Equal(0, rows);
        Assert.True((await db.Users.AsNoTracking().SingleAsync(u => u.Id == demo.User.Id)).IsGuest);
    }

    [SkippableFact]
    public async Task The_Purge_Never_Tears_Down_A_Converted_Account()
    {
        await TestDb.RequireAsync(factory);
        using var f = Build(); var (client, demo) = await StartGuestAsync(f);
        (await client.PostAsJsonAsync("/api/auth/guest/convert", Body())).EnsureSuccessStatusCode();
        var sweeper = f.Services.GetServices<IHostedService>().OfType<RetentionSweepScheduler>().Single();
        // Simulates the race: the id was selected as an expired guest, then the owner converted.
        Assert.False(await sweeper.PurgeOneGuestAsync(demo.User.Id, DateTimeOffset.UtcNow.AddDays(30), default));
        using var scope = f.Services.CreateScope();
        Assert.True(await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.AnyAsync(u => u.Id == demo.User.Id));
    }

    // Auth non-negotiable: the conversion must be provably ATOMIC. Two
    // concurrent conversions of the SAME guest row (different target
    // emails, so only the row-level guard — not the email-uniqueness index
    // — can be what stops the second one) must never both succeed. Calls
    // GuestConversion.TryConvertAsync directly (two independent
    // AppDbContext instances, like two concurrent requests would each get
    // their own scoped context) rather than going through HttpClient, so
    // the assertion is about the ONE UPDATE statement itself, not
    // ASP.NET's request-pipeline serialization.
    [SkippableFact]
    public async Task Concurrent_Conversions_Of_The_Same_Guest_Convert_Exactly_Once()
    {
        await TestDb.RequireAsync(factory);
        using var f = Build();
        var (_, demo) = await StartGuestAsync(f);
        var now = DateTimeOffset.UtcNow;

        using var scopeA = f.Services.CreateScope();
        using var scopeB = f.Services.CreateScope();
        var dbA = scopeA.ServiceProvider.GetRequiredService<AppDbContext>();
        var dbB = scopeB.ServiceProvider.GetRequiredService<AppDbContext>();

        var emailA = $"race-a+{Guid.NewGuid():N}@spectr.test";
        var emailB = $"race-b+{Guid.NewGuid():N}@spectr.test";

        var taskA = GuestConversion.TryConvertAsync(dbA, demo.User.Id, emailA, "hashA", "A", autoVerify: false, now, default);
        var taskB = GuestConversion.TryConvertAsync(dbB, demo.User.Id, emailB, "hashB", "B", autoVerify: false, now, default);
        var results = await Task.WhenAll(taskA, taskB);

        // Exactly one of the two racing UPDATEs matched the row (WHERE
        // is_guest = true); the other found it already converted.
        Assert.Equal(1, results.Sum());
        Assert.Contains(1, results);
        Assert.Contains(0, results);

        using var verifyScope = f.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<AppDbContext>();
        var final = await verifyDb.Users.AsNoTracking().SingleAsync(u => u.Id == demo.User.Id);
        Assert.False(final.IsGuest);
        // The winner's email stuck — whichever one it was, never a hybrid.
        Assert.True(final.Email == emailA || final.Email == emailB);
    }
}
