using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Spectr.Bff.Options;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 3.5 (NFR16) — the reaper must fail ABANDONED work but never a queue
// that is merely waiting out a worker restart: processing jobs reap on the
// short window from started_at; pending jobs only after the long grace.
public sealed class StaleJobReaperTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    // Story 12.2: the reaper reads the worker heartbeat to decide whether the
    // FAST pending tier applies. Tests inject a deterministic stub — the
    // Func<long?> may throw to exercise the probe-failure fallback.
    private sealed class StubHeartbeat(Func<long?> ageSeconds) : IWorkerHeartbeat
    {
        public Task<long?> AgeSecondsAsync(CancellationToken ct = default)
            => Task.FromResult(ageSeconds());
    }

    private StaleJobReaper NewReaper(
        IWorkerHeartbeat? heartbeat = null, WorkerOptions? options = null) => new(
        _factory.Services.GetRequiredService<IServiceScopeFactory>(),
        Microsoft.Extensions.Options.Options.Create(
            options ?? new WorkerOptions { StaleJobMinutes = 30, PendingGraceMinutes = 240 }),
        // Default = fresh heartbeat (busy-but-live worker): the long-grace
        // tests keep their original semantics — the fast tier never fires.
        heartbeat ?? new StubHeartbeat(() => 0),
        NullLogger<StaleJobReaper>.Instance);

    private async Task<Guid> SeedJobAsync(
        Guid userId, Guid versionId, string status,
        DateTimeOffset dispatchedAt, DateTimeOffset? startedAt)
    {
        var jobId = Guid.NewGuid();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.AnalysisJobs.Add(new AnalysisJob
        {
            Id = jobId,
            UserId = userId,
            VersionId = versionId,
            Status = status,
            DispatchedAt = dispatchedAt,
            StartedAt = startedAt,
        });
        await db.SaveChangesAsync();
        return jobId;
    }

    private async Task<string?> StatusOfAsync(Guid jobId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.AnalysisJobs.AsNoTracking()
            .Where(j => j.Id == jobId).Select(j => j.Status).FirstOrDefaultAsync();
    }

    private async Task CleanupAsync(params Guid[] jobIds)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.AnalysisJobs.Where(j => jobIds.Contains(j.Id)).ExecuteDeleteAsync();
    }

    [Fact]
    public async Task Pending_Jobs_Survive_The_Processing_Window_But_Not_The_Grace()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var (_, versionId) = await TestSeed.SongWithVersionAsync(_factory, userId);
        var now = DateTimeOffset.UtcNow;

        // Queued 2 h ago (worker down) — must SURVIVE (NFR16: queued, not failed).
        var queuedSurvivor = await SeedJobAsync(userId, versionId, "pending",
            dispatchedAt: now.AddHours(-2), startedAt: null);
        // Queued 5 h ago — beyond the 4 h grace: truly orphaned, resurface.
        var queuedOrphan = await SeedJobAsync(userId, versionId, "pending",
            dispatchedAt: now.AddHours(-5), startedAt: null);
        // Started 40 min ago and abandoned — the classic reap.
        var abandoned = await SeedJobAsync(userId, versionId, "processing",
            dispatchedAt: now.AddHours(-1), startedAt: now.AddMinutes(-40));
        // Started 5 min ago — live, untouched.
        var live = await SeedJobAsync(userId, versionId, "processing",
            dispatchedAt: now.AddMinutes(-6), startedAt: now.AddMinutes(-5));

        try
        {
            await NewReaper().ReapAsync(CancellationToken.None);

            Assert.Equal("pending", await StatusOfAsync(queuedSurvivor));   // NFR16
            Assert.Equal("failed", await StatusOfAsync(queuedOrphan));
            Assert.Equal("failed", await StatusOfAsync(abandoned));
            Assert.Equal("processing", await StatusOfAsync(live));

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var reaped = await db.AnalysisJobs.AsNoTracking().SingleAsync(j => j.Id == abandoned);
            Assert.Equal("worker_unavailable", reaped.ErrorCode); // never invalid_file
        }
        finally
        {
            await CleanupAsync(queuedSurvivor, queuedOrphan, abandoned, live);
        }
    }

    // Story 12.2 (AC2) — the heartbeat-aware fast pending tier: a DEAD worker
    // (stale/absent heartbeat) fails queued jobs after the short grace; a
    // BUSY worker (fresh heartbeat) keeps the long grace so its queue is
    // never false-failed.
    [Fact]
    public async Task Pending_Fast_Tier_Fires_Only_When_The_Heartbeat_Is_Stale()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var (_, versionId) = await TestSeed.SongWithVersionAsync(_factory, userId);
        var now = DateTimeOffset.UtcNow;

        var opts = new WorkerOptions
        {
            StaleJobMinutes = 30,
            PendingGraceMinutes = 240,
            PendingNoWorkerGraceMinutes = 5,
            HeartbeatStaleSeconds = 60,
        };

        // Queued 2 min ago — younger than even the short grace: survives.
        var young = await SeedJobAsync(userId, versionId, "pending",
            dispatchedAt: now.AddMinutes(-2), startedAt: null);
        // Queued 10 min ago — past the short grace: fails when worker is dead.
        var orphaned = await SeedJobAsync(userId, versionId, "pending",
            dispatchedAt: now.AddMinutes(-10), startedAt: null);
        // Started 5 min ago — processing behavior must be unchanged by the tier.
        var live = await SeedJobAsync(userId, versionId, "processing",
            dispatchedAt: now.AddMinutes(-6), startedAt: now.AddMinutes(-5));

        try
        {
            // FRESH heartbeat (busy worker) → fast tier must NOT fire.
            await NewReaper(new StubHeartbeat(() => 0), opts).ReapAsync(CancellationToken.None);
            Assert.Equal("pending", await StatusOfAsync(orphaned));

            // STALE heartbeat (dead worker) → past-short-grace pending fails;
            // young pending and live processing survive.
            await NewReaper(new StubHeartbeat(() => 999), opts).ReapAsync(CancellationToken.None);
            Assert.Equal("pending", await StatusOfAsync(young));
            Assert.Equal("failed", await StatusOfAsync(orphaned));
            Assert.Equal("processing", await StatusOfAsync(live));

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var reaped = await db.AnalysisJobs.AsNoTracking().SingleAsync(j => j.Id == orphaned);
            Assert.Equal("worker_unavailable", reaped.ErrorCode); // reuses the wired UI path
        }
        finally
        {
            await CleanupAsync(young, orphaned, live);
        }
    }

    // Story 12.2 (AC2) — an ABSENT heartbeat (no worker ever registered) is a
    // dead worker too: null age must arm the fast tier.
    [Fact]
    public async Task Pending_Fast_Tier_Fires_When_No_Heartbeat_Exists()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var (_, versionId) = await TestSeed.SongWithVersionAsync(_factory, userId);

        var opts = new WorkerOptions { PendingNoWorkerGraceMinutes = 5 };
        var orphaned = await SeedJobAsync(userId, versionId, "pending",
            dispatchedAt: DateTimeOffset.UtcNow.AddMinutes(-10), startedAt: null);

        try
        {
            await NewReaper(new StubHeartbeat(() => null), opts).ReapAsync(CancellationToken.None);
            Assert.Equal("failed", await StatusOfAsync(orphaned));
        }
        finally
        {
            await CleanupAsync(orphaned);
        }
    }

    // Story 12.2 (AC2) — a Redis probe error is liveness UNKNOWN, not "dead":
    // the fast tier must not fire, and the EF-only reap must keep working.
    [Fact]
    public async Task Heartbeat_Probe_Failure_Falls_Back_To_The_Long_Grace_Only()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var (_, versionId) = await TestSeed.SongWithVersionAsync(_factory, userId);
        var now = DateTimeOffset.UtcNow;

        var opts = new WorkerOptions
        {
            StaleJobMinutes = 30,
            PendingGraceMinutes = 240,
            PendingNoWorkerGraceMinutes = 5,
        };

        // Pending 10 min — fast tier would fail it, but the probe error means
        // liveness is unknown → long grace only → survives.
        var pending = await SeedJobAsync(userId, versionId, "pending",
            dispatchedAt: now.AddMinutes(-10), startedAt: null);
        // Abandoned processing — the classic reap must survive a Redis outage.
        var abandoned = await SeedJobAsync(userId, versionId, "processing",
            dispatchedAt: now.AddHours(-1), startedAt: now.AddMinutes(-40));

        try
        {
            var throwing = new StubHeartbeat(() =>
                throw new InvalidOperationException("redis unreachable"));
            await NewReaper(throwing, opts).ReapAsync(CancellationToken.None);

            Assert.Equal("pending", await StatusOfAsync(pending));
            Assert.Equal("failed", await StatusOfAsync(abandoned));
        }
        finally
        {
            await CleanupAsync(pending, abandoned);
        }
    }

    [Fact]
    public async Task Progress_Restores_Via_The_Poll_Path_For_A_Processing_Job()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        // Story 3.5 AC1 (FR8): the Results page restores progress by polling
        // GET /jobs/{id} — a mid-flight job must surface status + phase + pct.
        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var (_, versionId) = await TestSeed.SongWithVersionAsync(_factory, userId);

        var jobId = Guid.NewGuid();
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.AnalysisJobs.Add(new AnalysisJob
            {
                Id = jobId,
                UserId = userId,
                VersionId = versionId,
                Status = "processing",
                CurrentPhase = "stem_clash",
                PhasePct = 0.55,
                StartedAt = DateTimeOffset.UtcNow.AddMinutes(-2),
            });
            await db.SaveChangesAsync();
        }

        try
        {
            var body = await client.GetFromJsonAsync<System.Text.Json.JsonElement>($"/api/jobs/{jobId}");
            Assert.Equal("processing", body.GetProperty("status").GetString());
            Assert.Equal("stem_clash", body.GetProperty("currentPhase").GetString());
            Assert.Equal(0.55, body.GetProperty("phasePct").GetDouble(), precision: 2);
        }
        finally
        {
            await CleanupAsync(jobId);
        }
    }
}
