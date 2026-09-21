using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Xunit;

namespace Spectr.Bff.Tests;

// Task D6 — default-deny guest guard, quotas, coach cap (spec D4/D5/D7).
// Shares the "DemoAuth" collection with the other demo-auth suites: they all
// read/count the SHARED users.is_guest rows and must not run in parallel
// with each other.
[Collection("DemoAuth")]
public sealed class GuestGuardTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    internal sealed class RecordingQueue : IJobQueue
    {
        public readonly List<(string Task, string Queue)> Sent = [];
        public Task EnqueueAsync(string t, object[] a, CancellationToken ct = default)
        { Sent.Add((t, "")); return Task.CompletedTask; }
        public Task EnqueueAsync(string t, object[] a, string q, CancellationToken ct = default)
        { Sent.Add((t, q)); return Task.CompletedTask; }
        public Task EnqueueDelayedAsync(string t, object[] a, string q, TimeSpan d, CancellationToken ct = default)
        { Sent.Add((t, q)); return Task.CompletedTask; }
    }

    private WebApplicationFactory<Program> Build(Action<IWebHostBuilder>? extra = null, RecordingQueue? queue = null) =>
        factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Demo:Enabled", "true");
            b.UseSetting("Demo:SnapshotKey", "");
            b.ConfigureTestServices(s =>
            {
                s.RemoveAll(typeof(IJobQueue));
                s.AddSingleton<IJobQueue>(queue ?? new RecordingQueue());
            });
            extra?.Invoke(b);
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

    private static async Task<string?> Code(HttpResponseMessage resp)
    {
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("error").GetProperty("code").GetString();
    }

    private static async Task<string?> Reason(HttpResponseMessage resp)
    {
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("error").GetProperty("details").GetProperty("reason").GetString();
    }

    private static MultipartFormDataContent Wav(string name, bool analyze)
    {
        var form = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(DemoSeeder.GenerateToneWav());
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        form.Add(fileContent, "file", name);
        form.Add(new StringContent(analyze ? "true" : "false"), "analyze");
        return form;
    }

    private static async Task<Guid> AnalysisIdAsync(WebApplicationFactory<Program> f, Guid jobId)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.Analyses.Where(a => a.JobId == jobId).Select(a => a.Id).SingleAsync();
    }

    // ── D4 theory: explicitly denied routes ─────────────────────────────────
    public static TheoryData<string, string> Denied => new()
    {
        { "DELETE", "/api/songs/{song}" }, { "DELETE", "/api/songs/{song}/permanent" }, { "POST", "/api/songs/{song}/restore" },
        { "POST", "/api/songs/" }, { "DELETE", "/api/versions/{version}" }, { "POST", "/api/versions/{version}/stems/classify" },
        { "POST", "/api/versions/{version}/als-key" }, { "POST", "/api/uploads/attachments/init" }, { "POST", "/api/me/delete" },
        { "PATCH", "/api/auth/me" }, { "PATCH", "/api/me/profile" }, { "POST", "/api/auth/resend-verification" },
        { "POST", "/api/billing/portal" }, { "POST", "/api/reports/{job}/phases/3/rerun" }, { "POST", "/api/jobs/{job}/retry" },
        { "GET", "/api/me/export" },
    };

    [SkippableTheory, MemberData(nameof(Denied))]
    public async Task A_Guest_Is_Refused_With_The_Typed_Envelope(string method, string template)
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        Guid userId = default;
        try
        {
            var (client, g) = await StartGuestAsync(f);
            userId = g.User.Id;
            var url = template.Replace("{song}", g.Demo.SongId.ToString()).Replace("{version}", g.Demo.VersionId.ToString()).Replace("{job}", g.Demo.JobId.ToString());
            var resp = await client.SendAsync(new HttpRequestMessage(new HttpMethod(method), url) { Content = JsonContent.Create(new { }) });
            Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
            Assert.Equal("guest_restricted", await Code(resp));
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    // ── D4 theory: explicitly allowed routes ────────────────────────────────
    public static TheoryData<string, string> Allowed => new()
    {
        { "PUT", "/api/versions/{version}/rack/draft" }, { "POST", "/api/versions/{version}/notes" }, { "PUT", "/api/versions/{version}/rating" },
        { "PATCH", "/api/songs/{song}" }, { "POST", "/api/reports/{job}/fix-rack/" }, { "PUT", "/api/compare/notes" }, { "POST", "/api/uploads/abort" },
    };

    [SkippableTheory, MemberData(nameof(Allowed))]
    public async Task Sandbox_Actions_Are_Never_Guest_Restricted(string method, string template)
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        Guid userId = default;
        try
        {
            var (client, g) = await StartGuestAsync(f);
            userId = g.User.Id;
            var url = template.Replace("{song}", g.Demo.SongId.ToString()).Replace("{version}", g.Demo.VersionId.ToString()).Replace("{job}", g.Demo.JobId.ToString());
            var body = JsonContent.Create(new { chain = new { order = Array.Empty<string>(), modules = new { }, masterBypass = false } });
            var resp = await client.SendAsync(new HttpRequestMessage(new HttpMethod(method), url) { Content = body });
            Assert.NotEqual(HttpStatusCode.Forbidden, resp.StatusCode); // a 400 from body validation is fine — a 403 is the bug
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task Anonymous_Endpoints_Still_Work_With_A_Guest_Bearer()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        Guid userId = default;
        try
        {
            var (client, g) = await StartGuestAsync(f);
            userId = g.User.Id;
            Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/auth/logout", null)).StatusCode);
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task A_Real_User_Is_Untouched_By_The_Guard()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        Guid userId = default;
        try
        {
            var client = f.CreateClient();
            var (uid, token) = await TestAuth.RegisterAsync(client);
            userId = uid;
            client.DefaultRequestHeaders.Authorization = new("Bearer", token);
            var resp = await client.PatchAsJsonAsync("/api/me/profile", new { displayName = "Still Me" });
            Assert.NotEqual(HttpStatusCode.Forbidden, resp.StatusCode);
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task One_Upload_Then_The_Quota_Closes()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        Guid userId = default;
        Guid versionId = default;
        try
        {
            var (client, g) = await StartGuestAsync(f);
            userId = g.User.Id;
            var uploaded = await client.PostAsync("/api/versions/", Wav("mine.wav", analyze: false));
            Assert.Equal(HttpStatusCode.OK, uploaded.StatusCode);
            versionId = (await uploaded.Content.ReadFromJsonAsync<UploadResponse>())!.VersionId;
            var second = await client.PostAsync("/api/versions/", Wav("again.wav", analyze: false));
            Assert.Equal(HttpStatusCode.Forbidden, second.StatusCode);
            Assert.Equal("upload_limit", await Reason(second));
            var state = await client.GetFromJsonAsync<GuestStateDto>("/api/me/guest");
            Assert.Equal((1, 1), (state!.UploadsUsed, state.UploadsMax));
        }
        finally
        {
            // The quota-check WAV lands on real IFileStorage — nothing else
            // deletes that blob, so do it explicitly before dropping the row.
            if (versionId != default)
            {
                using var scope = f.Services.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var path = await db.SongVersions.Where(v => v.Id == versionId).Select(v => v.FilePath).SingleOrDefaultAsync();
                if (path is not null)
                    await scope.ServiceProvider.GetRequiredService<IFileStorage>().DeleteAsync(path);
            }
            await DemoAuthEndpointsTests.CleanupAsync(f, userId);
            f.Dispose();
        }
    }

    [SkippableFact]
    public async Task One_Analysis_On_The_Free_Lane_Then_The_Quota_Closes()
    {
        await TestDb.RequireAsync(factory);
        var q = new RecordingQueue();
        var f = Build(queue: q);
        Guid userId = default;
        try
        {
            var (client, g) = await StartGuestAsync(f);
            userId = g.User.Id;
            var up = await (await client.PostAsync("/api/versions/", Wav("mine.wav", analyze: false))).Content.ReadFromJsonAsync<UploadResponse>();
            // Deviation from the brief's literal snippet: Reanalyze returns
            // 202 Accepted (Results.Accepted), not 200 OK — matches the
            // ReanalyzeResponse contract already in VersionEndpoints.cs.
            Assert.Equal(HttpStatusCode.Accepted, (await client.PostAsync($"/api/versions/{up!.VersionId}/analyze", null)).StatusCode);
            Assert.Contains((DramatiqTasks.AnalyzeAudioJob, DramatiqQueues.AnalysisFree), q.Sent);
            var again = await client.PostAsync($"/api/versions/{up.VersionId}/analyze", null);
            Assert.Equal(HttpStatusCode.Forbidden, again.StatusCode);
            Assert.Equal("analysis_limit", await Reason(again));
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task The_Global_Analysis_Arm_Fails_CLOSED()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        Guid userId = default;
        try
        {
            var (_, g) = await StartGuestAsync(f); // limits off → guest exists
            userId = g.User.Id;
            var strict = Build(b => b.UseSetting("RateLimits:Enabled", "true")
                .ConfigureTestServices(s =>
                {
                    s.RemoveAll(typeof(IRateLimiter));
                    s.AddSingleton<IRateLimiter>(new DemoAuthEndpointsTests.ThrowingLimiter());
                })).CreateClient();
            strict.DefaultRequestHeaders.Authorization = new("Bearer", g.AccessToken);
            var r = await strict.PostAsync($"/api/versions/{g.Demo.VersionId}/analyze", null);
            Assert.Equal(HttpStatusCode.ServiceUnavailable, r.StatusCode);
            Assert.Equal("demo_capacity", await Code(r));
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    [SkippableTheory, InlineData("true"), InlineData("false")]
    public async Task The_Coach_Cap_Trips_For_Guests_Whatever_The_Credit_Switch_Says(string creditsEnabled)
    {
        await TestDb.RequireAsync(factory);
        var f = Build(b => b.UseSetting("Credits:Enabled", creditsEnabled));
        Guid userId = default;
        try
        {
            var (client, g) = await StartGuestAsync(f);
            userId = g.User.Id;
            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                for (var i = 0; i < 20; i++)
                    db.UsageEvents.Add(new Spectr.Data.Entities.UsageEvent
                    {
                        UserId = g.User.Id, EventType = "coach_message", BillingPeriod = "2026-09", Reference = Guid.NewGuid().ToString(),
                    });
                await db.SaveChangesAsync();
            }
            var analysisId = await AnalysisIdAsync(f, g.Demo.JobId);
            var convo = await client.GetFromJsonAsync<CoachConversationDto>($"/api/coach/{analysisId}/conversation");
            Assert.Equal((20, true, "analysis"), (convo!.Caps.Limit, convo.Caps.CapReached, convo.Caps.Scope));
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task Guest_State_Is_404_For_Real_Users()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        Guid userId = default;
        try
        {
            var client = f.CreateClient();
            var (uid, token) = await TestAuth.RegisterAsync(client);
            userId = uid;
            client.DefaultRequestHeaders.Authorization = new("Bearer", token);
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/me/guest")).StatusCode);
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    // ── Ownership still applies on an ALLOWED route ─────────────────────────
    [SkippableFact]
    public async Task An_Allowed_Route_Still_Enforces_Ownership_Across_Guests()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        Guid userIdA = default, userIdB = default;
        try
        {
            var (_, a) = await StartGuestAsync(f);
            userIdA = a.User.Id;
            var (clientB, b) = await StartGuestAsync(f);
            userIdB = b.User.Id;
            // PUT /versions/{id}/rating is .AllowGuest() — but the version belongs to guest A.
            var resp = await clientB.PutAsJsonAsync($"/api/versions/{a.Demo.VersionId}/rating", new { score = 50 });
            Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userIdA, userIdB); f.Dispose(); }
    }

    // ── Default-deny BY CONSTRUCTION: every mapped mutating /api endpoint
    // without an allow marker must 403 a guest. This is the strongest form of
    // the theory above — it enumerates the LIVE route table instead of a
    // hand-picked list, so an endpoint added later with no marker is caught
    // automatically instead of silently shipping open.
    [SkippableFact]
    public async Task Every_Unmarked_Mutating_Api_Endpoint_Is_Guest_Restricted()
    {
        await TestDb.RequireAsync(factory);
        var f = Build();
        Guid userId = default;
        try
        {
            var (client, g) = await StartGuestAsync(f);
            userId = g.User.Id;

            var dataSource = f.Services.GetRequiredService<EndpointDataSource>();
            var candidates = new List<(string Method, RouteEndpoint Endpoint)>();
            foreach (var ep in dataSource.Endpoints.OfType<RouteEndpoint>())
            {
                var pattern = ep.RoutePattern.RawText ?? "";
                if (!pattern.StartsWith("/api/", StringComparison.Ordinal)) continue;
                if (ep.Metadata.GetMetadata<IAllowAnonymous>() is not null) continue;
                if (ep.Metadata.GetMetadata<GuestAllowed>() is not null) continue; // covered by the Allowed theory above
                if (ep.Metadata.GetMetadata<GuestDenied>() is not null) continue;  // covered by the Denied theory above (GET /me/export)
                var methodMeta = ep.Metadata.GetMetadata<HttpMethodMetadata>();
                if (methodMeta is null) continue;
                foreach (var method in methodMeta.HttpMethods)
                {
                    if (HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method)) continue;
                    candidates.Add((method, ep));
                }
            }
            Assert.True(candidates.Count > 10, $"route enumeration found too few candidates ({candidates.Count}) — the discovery itself is broken");

            var tested = 0;
            foreach (var (method, ep) in candidates)
            {
                var url = Concretize(ep.RoutePattern.RawText!, g.Demo);
                var accepts = ep.Metadata.GetMetadata<IAcceptsMetadata>();
                using var content = accepts is not null && accepts.ContentTypes.Any(c => c.Contains("multipart/form-data"))
                    ? (HttpContent)Wav("probe.wav", analyze: false)
                    : JsonContent.Create(new { });
                var resp = await client.SendAsync(new HttpRequestMessage(new HttpMethod(method), url) { Content = content });
                Assert.True(resp.StatusCode == HttpStatusCode.Forbidden,
                    $"{method} {url} should be 403 guest_restricted but was {(int)resp.StatusCode} {resp.StatusCode}");
                Assert.Equal("guest_restricted", await Code(resp));
                tested++;
            }
            Assert.True(tested > 10, $"expected to exercise a meaningful number of endpoints, exercised {tested}");
        }
        finally { await DemoAuthEndpointsTests.CleanupAsync(f, userId); f.Dispose(); }
    }

    private static string Concretize(string pattern, DemoTarget demo)
    {
        var result = System.Text.RegularExpressions.Regex.Replace(pattern, @"\{([^:}]+)(?::[^}]+)?\}", m =>
            m.Groups[1].Value switch
            {
                "songId" => demo.SongId.ToString(),
                "versionId" => demo.VersionId.ToString(),
                "jobId" => demo.JobId.ToString(),
                "analysisId" => demo.JobId.ToString(),
                "phase" => "3",
                _ => Guid.NewGuid().ToString(),
            });
        return result.StartsWith('/') ? result : "/" + result;
    }
}
