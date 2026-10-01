using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using Xunit;

namespace Spectr.Bff.Tests;

// Fix wave FW1 (final review C1) — POST /reports/{jobId}/verdicts/run/{slug}
// had no guest cap and no in-flight dedupe: every POST before the worker
// wrote its verdict row enqueued another run_specialist. Shares the
// "DemoAuth" collection with the other demo-auth suites (they all count the
// SHARED users.is_guest rows and must not run in parallel).
[Collection("DemoAuth")]
public sealed class GuestSpecialistRunCapTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    // Thread-safe: the parallel tests below enqueue from concurrent requests.
    private sealed class RecordingQueue : IJobQueue
    {
        private readonly object _gate = new();
        private readonly List<(string Task, object[] Args)> _sent = [];
        public List<(string Task, object[] Args)> Sent { get { lock (_gate) return [.. _sent]; } }
        public int Count(string task) => Sent.Count(s => s.Task == task);
        private Task Add(string t, object[] a) { lock (_gate) _sent.Add((t, a)); return Task.CompletedTask; }
        public Task EnqueueAsync(string t, object[] a, CancellationToken ct = default) => Add(t, a);
        public Task EnqueueAsync(string t, object[] a, string q, CancellationToken ct = default) => Add(t, a);
        public Task EnqueueDelayedAsync(string t, object[] a, string q, TimeSpan d, CancellationToken ct = default) => Add(t, a);
    }

    // Throws for one named action (mutable, so a test can recover it); every
    // other action passes.
    private sealed class ActionLimiter : IRateLimiter
    {
        public volatile string? ThrowAction;
        public Task<RateLimitResult> CheckAsync(
            string actorKey, string ip, string action, int limit, TimeSpan window, CancellationToken ct = default)
        {
            if (action == ThrowAction) throw new InvalidOperationException("limiter unavailable (test double)");
            return Task.FromResult(RateLimitResult.Ok);
        }
    }

    private sealed class ThrowingDistributedLock : IDistributedLock
    {
        public Task<string?> TryAcquireAsync(string key, TimeSpan ttl, CancellationToken ct = default)
            => throw new InvalidOperationException("redis unavailable (test double)");
        public Task ReleaseAsync(string key, string token, CancellationToken ct = default)
            => Task.CompletedTask;
    }

    // Random per Build() so re-runs never collide with a `demo_create`
    // bucket a previous run spent (GuestCapsTests precedent).
    private sealed class FakeIpStartupFilter(string ip) : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) =>
            app =>
            {
                app.Use(async (ctx, nxt) =>
                {
                    ctx.Connection.RemoteIpAddress = IPAddress.Parse(ip);
                    await nxt();
                });
                next(app);
            };
    }

    private static string RandomIp() =>
        $"10.{Random.Shared.Next(1, 254)}.{Random.Shared.Next(1, 254)}.{Random.Shared.Next(1, 254)}";

    private WebApplicationFactory<Program> Build(
        RecordingQueue queue, IRateLimiter? limiter = null, IDistributedLock? distLock = null, bool rateLimits = false) =>
        factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Demo:Enabled", "true");
            b.UseSetting("Demo:SnapshotKey", "");
            // These tests pin the dedupe/cap seam, not billing: keep real users uncharged.
            b.UseSetting("Credits:Enabled", "false");
            if (rateLimits) b.UseSetting("RateLimits:Enabled", "true");
            b.ConfigureTestServices(s =>
            {
                s.RemoveAll(typeof(IJobQueue));
                s.AddSingleton<IJobQueue>(queue);
                if (limiter is not null)
                {
                    s.RemoveAll(typeof(IRateLimiter));
                    s.AddSingleton(limiter);
                }
                if (distLock is not null)
                {
                    s.RemoveAll(typeof(IDistributedLock));
                    s.AddSingleton(distLock);
                }
                if (rateLimits) s.AddSingleton<IStartupFilter>(new FakeIpStartupFilter(RandomIp()));
            });
        });

    private static async Task<(HttpClient Client, Guid UserId)> StartGuestAsync(WebApplicationFactory<Program> f)
    {
        var client = f.CreateClient();
        var resp = await client.PostAsync("/api/auth/demo", null);
        resp.EnsureSuccessStatusCode();
        var body = (await resp.Content.ReadFromJsonAsync<DemoStartResponse>())!;
        client.DefaultRequestHeaders.Authorization = new("Bearer", body.AccessToken);
        return (client, body.User.Id);
    }

    private static async Task<(HttpClient Client, Guid UserId)> RegisterRealUserAsync(WebApplicationFactory<Program> f)
    {
        var client = f.CreateClient();
        var (uid, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return (client, uid);
    }

    // A fresh complete job + analysis with no verdict rows, so no slug hits
    // the "already has a verdict" 409.
    private static async Task<Guid> SeedAnalysisAsync(WebApplicationFactory<Program> f, Guid userId)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var jobId = Guid.NewGuid();
        db.AnalysisJobs.Add(new AnalysisJob { Id = jobId, UserId = userId, Status = "complete" });
        db.Analyses.Add(new Analysis { Id = Guid.NewGuid(), JobId = jobId, UserId = userId, FinalJson = "{}" });
        await db.SaveChangesAsync();
        return jobId;
    }

    private static async Task<int> SpecialistRunsMaxAsync(WebApplicationFactory<Program> f)
    {
        using var scope = f.Services.CreateScope();
        var ents = scope.ServiceProvider.GetRequiredService<EntitlementService>();
        return GuestLimits.Flag(await ents.GetFlagsAsync(CancellationToken.None), "guest_specialist_runs_max", 12);
    }

    // The success shape a first dispatch answers: 202 + {"status":"queued"}.
    private static async Task AssertQueuedAsync(HttpResponseMessage resp)
    {
        Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        Assert.Equal("queued", doc.RootElement.GetProperty("status").GetString());
    }

    private static async Task<(string? Code, string? Reason)> ErrorAsync(HttpResponseMessage resp)
    {
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        var err = doc.RootElement.GetProperty("error");
        var reason = err.TryGetProperty("details", out var d) && d.ValueKind == JsonValueKind.Object
            && d.TryGetProperty("reason", out var r) ? r.GetString() : null;
        return (err.GetProperty("code").GetString(), reason);
    }

    private static Task CleanupAsync(WebApplicationFactory<Program> f, params Guid[] userIds) =>
        DemoAuthEndpointsTests.CleanupAsync(f, userIds);

    // C1 — five parallel POSTs of the SAME (analysis, slug) dispatch once and
    // all answer the success shape; the duplicates never consume a guest slot
    // (the remaining max-1 distinct slugs still fit), and the run past the
    // cap is refused 403 specialist_limit with nothing enqueued.
    [SkippableFact]
    public async Task Parallel_Duplicates_Enqueue_Once_And_The_Guest_Cap_Refuses_The_Run_Past_It()
    {
        await TestDb.RequireAsync(factory);
        var queue = new RecordingQueue();
        var f = Build(queue, rateLimits: true);
        Guid guestId = default;
        try
        {
            var (client, uid) = await StartGuestAsync(f);
            guestId = uid;
            var jobId = await SeedAnalysisAsync(f, guestId);
            var max = await SpecialistRunsMaxAsync(f);
            Skip.If(max + 1 > SpecialistCatalog.Slugs.Count, "flag raised above the slug catalog — cannot exercise the cap");
            var slugs = SpecialistCatalog.Slugs;

            var dupes = await Task.WhenAll(Enumerable.Range(0, 5)
                .Select(_ => client.PostAsync($"/api/reports/{jobId}/verdicts/run/{slugs[0]}", null)));
            foreach (var r in dupes) await AssertQueuedAsync(r);
            Assert.Equal(1, queue.Count(DramatiqTasks.RunSpecialist));

            for (var i = 1; i < max; i++)
                await AssertQueuedAsync(await client.PostAsync($"/api/reports/{jobId}/verdicts/run/{slugs[i]}", null));
            Assert.Equal(max, queue.Count(DramatiqTasks.RunSpecialist));

            var over = await client.PostAsync($"/api/reports/{jobId}/verdicts/run/{slugs[max]}", null);
            Assert.Equal(HttpStatusCode.Forbidden, over.StatusCode);
            Assert.Equal(("guest_restricted", "specialist_limit"), await ErrorAsync(over));
            Assert.Equal(max, queue.Count(DramatiqTasks.RunSpecialist));
        }
        finally { await CleanupAsync(f, guestId); f.Dispose(); }
    }

    // C1 — the in-flight key applies to real users too: a second POST while
    // the first is still queued answers the same success shape, no 2nd enqueue.
    [SkippableFact]
    public async Task A_Real_Users_Duplicate_While_In_Flight_Enqueues_Once()
    {
        await TestDb.RequireAsync(factory);
        var queue = new RecordingQueue();
        var f = Build(queue);
        Guid userId = default;
        try
        {
            var (client, uid) = await RegisterRealUserAsync(f);
            userId = uid;
            var jobId = await SeedAnalysisAsync(f, userId);
            var slug = SpecialistCatalog.Slugs[0];

            await AssertQueuedAsync(await client.PostAsync($"/api/reports/{jobId}/verdicts/run/{slug}", null));
            await AssertQueuedAsync(await client.PostAsync($"/api/reports/{jobId}/verdicts/run/{slug}", null));
            Assert.Equal(1, queue.Count(DramatiqTasks.RunSpecialist));
        }
        finally { await CleanupAsync(f, userId); f.Dispose(); }
    }

    // C1 — the guest limiter fails CLOSED (503, nothing enqueued) and the
    // refused attempt must not leave its in-flight key behind: once the
    // limiter recovers, the same (analysis, slug) dispatches for real.
    [SkippableFact]
    public async Task Guest_Limiter_Exception_Is_503_With_No_Enqueue_And_Frees_The_In_Flight_Key()
    {
        await TestDb.RequireAsync(factory);
        var queue = new RecordingQueue();
        var limiter = new ActionLimiter { ThrowAction = "guest_specialist" };
        var f = Build(queue, limiter: limiter, rateLimits: true);
        Guid guestId = default;
        try
        {
            var (client, uid) = await StartGuestAsync(f);
            guestId = uid;
            var jobId = await SeedAnalysisAsync(f, guestId);
            var slug = SpecialistCatalog.Slugs[0];

            var resp = await client.PostAsync($"/api/reports/{jobId}/verdicts/run/{slug}", null);
            Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
            Assert.Equal("demo_capacity", (await ErrorAsync(resp)).Code);
            Assert.Equal(0, queue.Count(DramatiqTasks.RunSpecialist));

            limiter.ThrowAction = null;
            await AssertQueuedAsync(await client.PostAsync($"/api/reports/{jobId}/verdicts/run/{slug}", null));
            Assert.Equal(1, queue.Count(DramatiqTasks.RunSpecialist));
        }
        finally { await CleanupAsync(f, guestId); f.Dispose(); }
    }

    // C1 — the in-flight marker is unreachable: a guest fails CLOSED (503, no
    // enqueue); a real user fails OPEN and still gets their specialist run.
    [SkippableFact]
    public async Task In_Flight_Marker_Failure_Closes_For_Guests_And_Stays_Open_For_Real_Users()
    {
        await TestDb.RequireAsync(factory);
        var queue = new RecordingQueue();
        var f = Build(queue, distLock: new ThrowingDistributedLock());
        Guid guestId = default, userId = default;
        try
        {
            var slug = SpecialistCatalog.Slugs[0];

            var (guest, gid) = await StartGuestAsync(f);
            guestId = gid;
            var guestJob = await SeedAnalysisAsync(f, guestId);
            var refused = await guest.PostAsync($"/api/reports/{guestJob}/verdicts/run/{slug}", null);
            Assert.Equal(HttpStatusCode.ServiceUnavailable, refused.StatusCode);
            Assert.Equal("demo_capacity", (await ErrorAsync(refused)).Code);
            Assert.Equal(0, queue.Count(DramatiqTasks.RunSpecialist));

            var (real, uid) = await RegisterRealUserAsync(f);
            userId = uid;
            var realJob = await SeedAnalysisAsync(f, userId);
            await AssertQueuedAsync(await real.PostAsync($"/api/reports/{realJob}/verdicts/run/{slug}", null));
            Assert.Equal(1, queue.Count(DramatiqTasks.RunSpecialist));
        }
        finally { await CleanupAsync(f, guestId, userId); f.Dispose(); }
    }

    // DB-free pin of the seeded default (GuestCapsTests.Seed_Migration_Pins_The_Value
    // pattern — the flag ROW is live-tunable, only the migration can be pinned).
    [Fact]
    public void Seed_Migration_Pins_The_Specialist_Runs_Flag_And_Is_Idempotent()
    {
        var m = new Spectr.Data.Migrations.SeedGuestSpecialistRunsFlag();
        var up = string.Join(" ", m.UpOperations
            .OfType<Microsoft.EntityFrameworkCore.Migrations.Operations.SqlOperation>().Select(o => o.Sql));
        Assert.Matches(@"\('guest_specialist_runs_max',\s*'12',", up);
        Assert.Contains("ON CONFLICT (name) DO NOTHING", up);

        var down = string.Join(" ", m.DownOperations
            .OfType<Microsoft.EntityFrameworkCore.Migrations.Operations.SqlOperation>().Select(o => o.Sql));
        Assert.Contains("'guest_specialist_runs_max'", down);
    }
}
