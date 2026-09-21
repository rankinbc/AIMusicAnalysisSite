using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using Xunit;

namespace Spectr.Bff.Tests;

// Task D6 fix round 1 (Opus review of commit 0b63dfe), items 1-4 + migration:
// guest LLM work rides the free lane, the fix-rack generation cap, the
// upload-quota race backstop, and the per-IP analysis arm. Shares the
// "DemoAuth" collection with the other demo-auth suites — they all
// read/count the SHARED users.is_guest rows and must not run in parallel.
[Collection("DemoAuth")]
public sealed class GuestCapsTests(WebApplicationFactory<Program> factory)
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

    // Records every action it's asked about (so a test can prove ordering —
    // e.g. the per-IP arm short-circuits before the global arm is ever
    // called) and can be told to deny or throw for one named action.
    private sealed class RecordingActionLimiter : IRateLimiter
    {
        public readonly List<string> Actions = [];
        public string? DenyAction;
        public string? ThrowAction;
        public Task<RateLimitResult> CheckAsync(
            string actorKey, string ip, string action, int limit, TimeSpan window, CancellationToken ct = default)
        {
            Actions.Add(action);
            if (action == ThrowAction) throw new InvalidOperationException("limiter unavailable (test double)");
            if (action == DenyAction) return Task.FromResult(new RateLimitResult(false, window));
            return Task.FromResult(RateLimitResult.Ok);
        }
    }

    // Fakes a stable client IP — TestServer's Connection.RemoteIpAddress is
    // null by default, which fail-opens any IP-keyed arm (precedent:
    // AbuseContainmentTests.FakeIpStartupFilter, AnonAnalysisTests). Random
    // per Build() call (not a fixed literal) so re-running this suite never
    // collides with a `demo_create` bucket a previous run already spent —
    // that action shares the SAME RateLimits:Enabled gate and IP dimension
    // as the arms under test here.
    private sealed class FakeIpStartupFilter(string ip) : Microsoft.AspNetCore.Hosting.IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) =>
            app =>
            {
                app.Use(async (ctx, nxt) =>
                {
                    ctx.Connection.RemoteIpAddress = System.Net.IPAddress.Parse(ip);
                    await nxt();
                });
                next(app);
            };
    }

    private static string RandomIp() =>
        $"10.{Random.Shared.Next(1, 254)}.{Random.Shared.Next(1, 254)}.{Random.Shared.Next(1, 254)}";

    // rateLimits defaults OFF, matching Development's ambient default
    // (GuestGuardTests precedent) — `POST /api/auth/demo` itself is gated
    // behind the SAME RateLimits:Enabled flag (`demo_create`, 5/IP/hour), so
    // turning it on for every test in this class would rate-limit guest
    // minting itself. Only the specific tests proving a limiter-backed cap
    // (items 2-4) opt in, each with its own fresh fake IP.
    private WebApplicationFactory<Program> Build(
        RecordingQueue? queue = null, IRateLimiter? limiter = null, bool rateLimits = false, bool fakeIp = false) =>
        factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Demo:Enabled", "true");
            b.UseSetting("Demo:SnapshotKey", "");
            if (rateLimits) b.UseSetting("RateLimits:Enabled", "true");
            b.ConfigureTestServices(s =>
            {
                s.RemoveAll(typeof(IJobQueue));
                s.AddSingleton<IJobQueue>(queue ?? new RecordingQueue());
                if (limiter is not null)
                {
                    s.RemoveAll(typeof(IRateLimiter));
                    s.AddSingleton(limiter);
                }
                if (fakeIp)
                    s.AddSingleton<Microsoft.AspNetCore.Hosting.IStartupFilter>(new FakeIpStartupFilter(RandomIp()));
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
        var email = $"guestcaps+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync("/api/auth/register", new { email, password = "correct-horse-battery" });
        reg.EnsureSuccessStatusCode();
        var auth = await reg.Content.ReadFromJsonAsync<AuthResponse>();
        client.DefaultRequestHeaders.Authorization = new("Bearer", auth!.AccessToken);
        return (client, auth.User.Id);
    }

    // Inserts a completed analysis_job + analysis (+ song/version when the
    // caller needs a VersionId, e.g. fix-rack) directly — avoids running the
    // full upload+worker pipeline. Pattern: RerunPhaseTests.SeedAnalysis.
    private static async Task<Guid> SeedAnalysisAsync(WebApplicationFactory<Program> f, Guid userId, bool withVersion)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var jobId = Guid.NewGuid();
        Guid? versionId = null;
        if (withVersion)
        {
            var song = new Song { Id = Guid.NewGuid(), UserId = userId, Name = "Guest caps test" };
            var version = new SongVersion
            {
                Id = Guid.NewGuid(), SongId = song.Id, FilePath = "audio/guestcaps/x.wav", VersionNumber = 1,
            };
            db.Songs.Add(song);
            db.SongVersions.Add(version);
            versionId = version.Id;
        }
        db.AnalysisJobs.Add(new AnalysisJob { Id = jobId, UserId = userId, Status = "complete", VersionId = versionId });
        db.Analyses.Add(new Analysis
        {
            Id = Guid.NewGuid(), JobId = jobId, UserId = userId, VersionId = versionId, FinalJson = "{}",
        });
        await db.SaveChangesAsync();
        return jobId;
    }

    private static MultipartFormDataContent Wav(string name)
    {
        var form = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(DemoSeeder.GenerateToneWav());
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        form.Add(fileContent, "file", name);
        form.Add(new StringContent("false"), "analyze");
        return form;
    }

    private static async Task<string?> Code(HttpResponseMessage resp)
    {
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("error").GetProperty("code").GetString();
    }

    private static Task CleanupAsync(WebApplicationFactory<Program> f, params Guid[] userIds) =>
        DemoAuthEndpointsTests.CleanupAsync(f, userIds);

    // ── item 1: guest LLM work rides the free lane ──────────────────────────

    [SkippableFact]
    public async Task Guest_LLM_Work_Enqueues_On_Analysis_Free_Real_User_Unchanged()
    {
        await TestDb.RequireAsync(factory);
        var queue = new RecordingQueue();
        var f = Build(queue);
        Guid guestId = default, realUserId = default;
        try
        {
            var (guestClient, g) = await StartGuestAsync(f);
            guestId = g.User.Id;
            var slug = SpecialistCatalog.Slugs.First();

            // A FRESH analysis (not the demo target, which is seeded with a
            // routing plan already persisted — lazy triage wouldn't fire).
            var guestJobId = await SeedAnalysisAsync(f, guestId, withVersion: true);

            var fr = await guestClient.PostAsync($"/api/reports/{guestJobId}/fix-rack/", null);
            Assert.Equal(HttpStatusCode.Accepted, fr.StatusCode);

            var sp = await guestClient.PostAsync($"/api/reports/{guestJobId}/verdicts/run/{slug}", null);
            Assert.Equal(HttpStatusCode.Accepted, sp.StatusCode);

            // Lazy triage fires on the first verdicts-list poll (no plan persisted yet).
            var list = await guestClient.GetAsync($"/api/reports/{guestJobId}/verdicts/");
            Assert.Equal(HttpStatusCode.OK, list.StatusCode);

            Assert.Equal(3, queue.Sent.Count);
            Assert.All(queue.Sent, s => Assert.Equal(DramatiqQueues.AnalysisFree, s.Queue));
            Assert.Contains(queue.Sent, s => s.Task == DramatiqTasks.GenerateFixRack);
            Assert.Contains(queue.Sent, s => s.Task == DramatiqTasks.RunSpecialist);
            Assert.Contains(queue.Sent, s => s.Task == DramatiqTasks.RunTriage);

            // Real (non-guest) user: same three call sites, tier queue untouched.
            var (realClient, uid) = await RegisterRealUserAsync(f);
            realUserId = uid;
            var realJobId = await SeedAnalysisAsync(f, realUserId, withVersion: true);
            queue.Sent.Clear();

            var frReal = await realClient.PostAsync($"/api/reports/{realJobId}/fix-rack/", null);
            Assert.Equal(HttpStatusCode.Accepted, frReal.StatusCode);
            var spReal = await realClient.PostAsync($"/api/reports/{realJobId}/verdicts/run/{slug}", null);
            Assert.Equal(HttpStatusCode.Accepted, spReal.StatusCode);
            var listReal = await realClient.GetAsync($"/api/reports/{realJobId}/verdicts/");
            Assert.Equal(HttpStatusCode.OK, listReal.StatusCode);

            Assert.Equal(3, queue.Sent.Count);
            Assert.All(queue.Sent, s => Assert.Equal(DramatiqQueues.AnalysisPaid, s.Queue));
        }
        finally { await CleanupAsync(f, guestId, realUserId); f.Dispose(); }
    }

    // ── item 2: guest fix-rack cap ───────────────────────────────────────────

    [SkippableFact]
    public async Task Third_Guest_Fix_Rack_Post_Is_403_Restricted()
    {
        await TestDb.RequireAsync(factory);
        var f = Build(rateLimits: true, fakeIp: true);
        Guid guestId = default;
        try
        {
            var (client, g) = await StartGuestAsync(f);
            guestId = g.User.Id;

            // guest_fix_racks_max seeds 2 (20260921064005_SeedGuestCapFlags).
            var r1 = await client.PostAsync($"/api/reports/{g.Demo.JobId}/fix-rack/", null);
            Assert.Equal(HttpStatusCode.Accepted, r1.StatusCode);
            var r2 = await client.PostAsync($"/api/reports/{g.Demo.JobId}/fix-rack/", null);
            Assert.Equal(HttpStatusCode.Accepted, r2.StatusCode);

            var r3 = await client.PostAsync($"/api/reports/{g.Demo.JobId}/fix-rack/", null);
            Assert.Equal(HttpStatusCode.Forbidden, r3.StatusCode);
            Assert.Equal("guest_restricted", await Code(r3));
        }
        finally { await CleanupAsync(f, guestId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task Guest_Fix_Rack_Limiter_Exception_Fails_Closed_503()
    {
        await TestDb.RequireAsync(factory);
        var limiter = new RecordingActionLimiter { ThrowAction = "guest_fix_rack" };
        var f = Build(limiter: limiter, rateLimits: true);
        Guid guestId = default;
        try
        {
            var (client, g) = await StartGuestAsync(f);
            guestId = g.User.Id;

            var resp = await client.PostAsync($"/api/reports/{g.Demo.JobId}/fix-rack/", null);
            Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
            Assert.Equal("demo_capacity", await Code(resp));
        }
        finally { await CleanupAsync(f, guestId); f.Dispose(); }
    }

    // ── item 3: upload quota race backstop ───────────────────────────────────

    [SkippableFact]
    public async Task Eight_Parallel_Guest_Uploads_Create_Exactly_The_Quota()
    {
        await TestDb.RequireAsync(factory);
        var f = Build(rateLimits: true, fakeIp: true);
        Guid guestId = default;
        try
        {
            var (client, g) = await StartGuestAsync(f);
            guestId = g.User.Id;

            var tasks = Enumerable.Range(0, 8)
                .Select(i => client.PostAsync("/api/versions/", Wav($"race-{i}.wav")))
                .ToArray();
            await Task.WhenAll(tasks);

            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var used = await db.SongVersions.CountAsync(v =>
                !v.FilePath.StartsWith("audio/demo/")
                && db.Songs.Any(s => s.Id == v.SongId && s.UserId == guestId));
            Assert.Equal(1, used); // guest_uploads_max seeds 1
        }
        finally { await CleanupAsync(f, guestId); f.Dispose(); }
    }

    // ── item 4: per-IP analysis arm before the global arm ────────────────────

    [SkippableFact]
    public async Task Per_Ip_Analysis_Arm_Trips_Before_Global_Arm_And_Fails_Closed()
    {
        await TestDb.RequireAsync(factory);

        // (a) denied — proves the arm trips, and that it does so BEFORE the
        // global "guest_analysis" arm is ever consulted.
        var deny = new RecordingActionLimiter { DenyAction = "guest_analysis_ip" };
        var f1 = Build(limiter: deny, rateLimits: true, fakeIp: true);
        Guid guest1 = default;
        try
        {
            var (client, g) = await StartGuestAsync(f1);
            guest1 = g.User.Id;
            var resp = await client.PostAsync($"/api/versions/{g.Demo.VersionId}/analyze", null);
            Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
            Assert.Equal("demo_capacity", await Code(resp));
            Assert.Contains("guest_analysis_ip", deny.Actions);
            Assert.DoesNotContain("guest_analysis", deny.Actions);
        }
        finally { await CleanupAsync(f1, guest1); f1.Dispose(); }

        // (b) throws — fails CLOSED, same shape.
        var throwing = new RecordingActionLimiter { ThrowAction = "guest_analysis_ip" };
        var f2 = Build(limiter: throwing, rateLimits: true, fakeIp: true);
        Guid guest2 = default;
        try
        {
            var (client, g) = await StartGuestAsync(f2);
            guest2 = g.User.Id;
            var resp = await client.PostAsync($"/api/versions/{g.Demo.VersionId}/analyze", null);
            Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
            Assert.Equal("demo_capacity", await Code(resp));
            Assert.DoesNotContain("guest_analysis", throwing.Actions);
        }
        finally { await CleanupAsync(f2, guest2); f2.Dispose(); }
    }

    // ── migration: DB-free pin of the two seeded flag values ─────────────────
    // Pattern: GuestSchemaTests.Seed_Migration_Pins_The_Value — the flag ROWS
    // are live-tunable, so only the MIGRATION (no database) can be pinned.

    [Theory]
    [InlineData("guest_fix_racks_max", "2")]
    [InlineData("guest_analyses_per_ip_hourly", "2")]
    public void Seed_Migration_Pins_The_Value(string name, string value)
    {
        var sql = string.Join(" ", new Spectr.Data.Migrations.SeedGuestCapFlags().UpOperations
            .OfType<Microsoft.EntityFrameworkCore.Migrations.Operations.SqlOperation>().Select(o => o.Sql));
        Assert.Matches($@"\('{name}',\s*'{value}',", sql);
    }

    [Fact]
    public void Seed_Migration_Down_Deletes_Exactly_The_Two_Names()
    {
        var sql = string.Join(" ", new Spectr.Data.Migrations.SeedGuestCapFlags().DownOperations
            .OfType<Microsoft.EntityFrameworkCore.Migrations.Operations.SqlOperation>().Select(o => o.Sql));
        Assert.Contains("'guest_fix_racks_max', 'guest_analyses_per_ip_hourly'", sql);
    }
}
