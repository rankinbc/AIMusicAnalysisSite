using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using Xunit;

namespace Spectr.Bff.Tests;

// Task D6 fix round 1, Part B — the marker-inventory test (IMPORTANT item 9),
// a real-paid-user routing regression test, and the two D5-parked
// IGuestSeeder tests. Split out of GuestGuardTests.cs per the brief's ~500
// line limit. Shares the "DemoAuth" collection — see GuestGuardTests.cs.
[Collection("DemoAuth")]
public sealed class GuestGuardInventoryTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    // ── item 9: frozen marker inventory ──────────────────────────────────────
    // WHY: the exhaustive default-deny test (GuestGuardTests.
    // Every_Unmarked_Mutating_Api_Endpoint_Is_Guest_Restricted) only proves
    // UNMARKED endpoints are closed — it explicitly SKIPS anything carrying a
    // GuestAllowed/GuestDenied marker (Auth/GuestGuard.cs), so a route that
    // ships with an unreviewed `.AllowGuest()` is invisible to it. This list
    // is the live route table's marker set, captured once and frozen: opening
    // (or closing) a route to guests now requires a deliberate edit here, and
    // any accidental marker change fails this test instead of shipping quiet.
    private static readonly (string Method, string Pattern, string Marker)[] FrozenMarkers =
    [
        ("POST", "/api/coach/{analysisId:guid}/messages", "None"),
        ("DELETE", "/api/compare/notes", "None"),
        ("PUT", "/api/compare/notes", "None"),
        ("GET", "/api/me/export", "Denied"),
        ("POST", "/api/reports/{jobId:guid}/fix-rack/", "None"),
        ("POST", "/api/reports/{jobId:guid}/verdicts/run/{specialist}", "None"),
        ("PATCH", "/api/songs/{songId:guid}", "None"),
        ("POST", "/api/songs/{songId:guid}/tags", "None"),
        ("DELETE", "/api/songs/{songId:guid}/tags/{tagId:guid}", "None"),
        ("POST", "/api/uploads/abort", "None"),
        ("POST", "/api/uploads/complete", "Upload"),
        ("POST", "/api/uploads/init", "Upload"),
        ("POST", "/api/verdicts/{verdictId}/applied", "None"),
        ("POST", "/api/verdicts/{verdictId}/dismiss", "None"),
        ("POST", "/api/verdicts/{verdictId}/feedback", "None"),
        ("POST", "/api/versions/", "Upload"),
        ("PATCH", "/api/versions/{versionId:guid}", "None"),
        ("POST", "/api/versions/{versionId:guid}/analyze", "None"),
        ("POST", "/api/versions/{versionId:guid}/notes", "None"),
        ("DELETE", "/api/versions/{versionId:guid}/notes/{noteId:guid}", "None"),
        ("PATCH", "/api/versions/{versionId:guid}/notes/{noteId:guid}", "None"),
        ("PUT", "/api/versions/{versionId:guid}/rack/draft", "None"),
        ("POST", "/api/versions/{versionId:guid}/rack/presets", "None"),
        ("DELETE", "/api/versions/{versionId:guid}/rack/presets/{presetId:guid}", "None"),
        ("DELETE", "/api/versions/{versionId:guid}/rating", "None"),
        ("PUT", "/api/versions/{versionId:guid}/rating", "None"),
        ("POST", "/api/versions/{versionId:guid}/set-current", "None"),
        ("POST", "/api/viz/presets", "None"),
        ("DELETE", "/api/viz/presets/{presetId:guid}", "None"),
    ];

    [SkippableFact]
    public async Task Guest_Marker_Inventory_Matches_The_Frozen_List()
    {
        await TestDb.RequireAsync(factory);
        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();
        var actual = new List<(string Method, string Pattern, string Marker)>();
        foreach (var ep in dataSource.Endpoints.OfType<RouteEndpoint>())
        {
            var pattern = ep.RoutePattern.RawText ?? "";
            if (!pattern.StartsWith("/api/", StringComparison.Ordinal)) continue;
            string? marker = null;
            if (ep.Metadata.GetMetadata<GuestAllowed>() is { } allowed) marker = allowed.Quota.ToString();
            else if (ep.Metadata.GetMetadata<GuestDenied>() is not null) marker = "Denied";
            if (marker is null) continue;
            var methodMeta = ep.Metadata.GetMetadata<HttpMethodMetadata>();
            if (methodMeta is null) continue;
            foreach (var method in methodMeta.HttpMethods)
                actual.Add((method, pattern, marker));
        }
        var sortedActual = actual.OrderBy(t => t.Pattern, StringComparer.Ordinal).ThenBy(t => t.Method, StringComparer.Ordinal).ToArray();
        var sortedExpected = FrozenMarkers.OrderBy(t => t.Pattern, StringComparer.Ordinal).ThenBy(t => t.Method, StringComparer.Ordinal).ToArray();
        Assert.Equal(sortedExpected, sortedActual);
    }

    // ── MINOR item 3: a real (paid) user's analyze dispatch is untouched ────
    private static MultipartFormDataContent Wav(string name)
    {
        var form = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(DemoSeeder.GenerateToneWav());
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        form.Add(fileContent, "file", name);
        form.Add(new StringContent("false"), "analyze");
        return form;
    }

    [SkippableFact]
    public async Task A_Real_Paid_User_Analyzing_Twice_Never_Routes_To_The_Guest_Free_Lane()
    {
        await TestDb.RequireAsync(factory);
        var queue = new RecordingJobQueue();
        var f = factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll(typeof(IJobQueue));
            s.AddSingleton<IJobQueue>(queue);
        }));
        Guid userId = default;
        try
        {
            var client = f.CreateClient();
            var (uid, token) = await TestAuth.RegisterAsync(client);
            userId = uid;
            client.DefaultRequestHeaders.Authorization = new("Bearer", token);

            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.CreditLedger.Add(new CreditLedgerEntry
                {
                    UserId = userId,
                    Amount = 10,
                    Reason = "purchase",
                    Reference = "pi_inventory_test",
                    IdempotencyKey = $"credits_purchase:inv_{Guid.NewGuid():N}",
                });
                await db.SaveChangesAsync();
            }

            for (var i = 0; i < 2; i++)
            {
                var upload = await client.PostAsync("/api/versions/", Wav($"real-{i}.wav"));
                Assert.True(upload.IsSuccessStatusCode, $"upload {i} was {(int)upload.StatusCode}");
                var versionId = (await upload.Content.ReadFromJsonAsync<UploadResponse>())!.VersionId;

                var analyze = await client.PostAsync($"/api/versions/{versionId}/analyze", null);
                Assert.True(analyze.IsSuccessStatusCode, $"analyze {i} was {(int)analyze.StatusCode}");
            }

            var analyzeEnqueues = queue.Enqueues.Where(e => e.Task == DramatiqTasks.AnalyzeAudioJob).ToList();
            Assert.Equal(2, analyzeEnqueues.Count);
            Assert.All(analyzeEnqueues, e => Assert.Equal(DramatiqQueues.AnalysisPaid, e.Queue));
            Assert.DoesNotContain(analyzeEnqueues, e => e.Queue == DramatiqQueues.AnalysisFree);
        }
        finally
        {
            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                // credit_ledger is trigger-enforced append-only (story 10.5) —
                // arm the session-scoped test escape hatch before deleting.
                await TestAuth.AllowPurgeAsync(db);
                await db.CreditLedger.Where(c => c.UserId == userId).ExecuteDeleteAsync();
            }
            await DemoAuthEndpointsTests.CleanupAsync(f, userId);
            f.Dispose();
        }
    }

    // ── MINOR item 4 (parked from the D5 review) ────────────────────────────
    private static string? ExtractCookiePair(HttpResponseMessage resp, string name)
    {
        if (!resp.Headers.TryGetValues("Set-Cookie", out var vals)) return null;
        return vals.FirstOrDefault(v => v.StartsWith($"{name}=", StringComparison.Ordinal))?.Split(';')[0];
    }

    private sealed class NullOnSeedGuestSeeder(IGuestSeeder inner) : IGuestSeeder
    {
        public Task<DemoSeedResult?> FindAsync(Guid userId, CancellationToken ct = default) =>
            inner.FindAsync(userId, ct);

        // Simulates SeedAsync failing to produce a demo on the CREATE path —
        // distinct from a thrown exception (already covered by the D5 I2 test).
        public Task<DemoSeedResult?> SeedAsync(Guid userId, CancellationToken ct = default) =>
            Task.FromResult<DemoSeedResult?>(null);
    }

    [SkippableFact]
    public async Task Seed_Returning_Null_On_The_Create_Path_Is_503_With_No_Leftover_Guest_Row()
    {
        await TestDb.RequireAsync(factory);
        var f = factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Demo:Enabled", "true");
            b.UseSetting("Demo:SnapshotKey", "");
            b.ConfigureTestServices(s =>
            {
                s.RemoveAll(typeof(IGuestSeeder));
                s.AddScoped<IGuestSeeder>(sp => new NullOnSeedGuestSeeder(sp.GetRequiredService<DemoSeeder>()));
            });
        });
        try
        {
            var client = f.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
            var resp = await client.PostAsync("/api/auth/demo", null);
            Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
            Assert.Equal("demo_unavailable", await DemoAuthEndpointsTests.Code(resp));

            var deviceCookie = ExtractCookiePair(resp, "spectr_device");
            Assert.NotNull(deviceCookie);
            var signedValue = deviceCookie!.Split('=', 2)[1];

            using var scope = f.Services.CreateScope();
            var cfg = scope.ServiceProvider.GetRequiredService<IConfiguration>();
            var deviceId = DeviceService.Verify(signedValue, cfg["Anon:SigningKey"]!);
            Assert.NotNull(deviceId);

            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Equal(0, await db.Users.CountAsync(u => u.IsGuest && u.GuestDeviceId == deviceId));
        }
        finally { f.Dispose(); }
    }

    [SkippableFact]
    public async Task Guest_Refresh_Cookie_Expires_Never_Outlives_GuestExpiresAt()
    {
        await TestDb.RequireAsync(factory);
        var f = factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Demo:Enabled", "true");
            b.UseSetting("Demo:SnapshotKey", "");
        });
        Guid userId = default;
        try
        {
            var client = f.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
            var demoResp = await client.PostAsync("/api/auth/demo", null);
            demoResp.EnsureSuccessStatusCode();
            var body = (await demoResp.Content.ReadFromJsonAsync<DemoStartResponse>())!;
            userId = body.User.Id;

            var refreshCookie = ExtractCookiePair(demoResp, "spectr_refresh");
            Assert.NotNull(refreshCookie);

            DateTimeOffset guestExpiresAt;
            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                guestExpiresAt = (await db.Users.Where(u => u.Id == userId).Select(u => u.GuestExpiresAt).SingleAsync())!.Value;
            }

            var req = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
            req.Headers.Add("Cookie", refreshCookie!);
            var refreshResp = await client.SendAsync(req);
            Assert.Equal(HttpStatusCode.OK, refreshResp.StatusCode);

            var setCookie = refreshResp.Headers.GetValues("Set-Cookie")
                .First(c => c.StartsWith("spectr_refresh=", StringComparison.Ordinal));
            var match = Regex.Match(setCookie, @"expires=([^;]+)", RegexOptions.IgnoreCase);
            Assert.True(match.Success, $"no expires attribute in: {setCookie}");
            var expiresOnCookie = DateTimeOffset.Parse(
                match.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AssumeUniversal);
            Assert.True(expiresOnCookie <= guestExpiresAt,
                $"cookie expires {expiresOnCookie:O} is after GuestExpiresAt {guestExpiresAt:O}");
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }
}
