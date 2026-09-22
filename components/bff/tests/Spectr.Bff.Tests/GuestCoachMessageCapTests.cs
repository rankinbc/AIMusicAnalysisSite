using System.Net;
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

// Fix wave FW1 (final review I2) — the guest coach cap was count-then-insert
// (CoachCapService counts usage_events; PostMessage inserts later), so
// parallel POSTs all read "under the cap" and all enqueued coach_reply onto
// the single coach worker. Shares the "DemoAuth" collection with the other
// demo-auth suites.
[Collection("DemoAuth")]
public sealed class GuestCoachMessageCapTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private sealed class RecordingQueue : IJobQueue
    {
        private readonly object _gate = new();
        private readonly List<string> _tasks = [];
        public int Count(string task) { lock (_gate) return _tasks.Count(t => t == task); }
        private Task Add(string t) { lock (_gate) _tasks.Add(t); return Task.CompletedTask; }
        public Task EnqueueAsync(string t, object[] a, CancellationToken ct = default) => Add(t);
        public Task EnqueueAsync(string t, object[] a, string q, CancellationToken ct = default) => Add(t);
        public Task EnqueueDelayedAsync(string t, object[] a, string q, TimeSpan d, CancellationToken ct = default) => Add(t);
    }

    private sealed class ThrowOnActionLimiter(string throwAction) : IRateLimiter
    {
        public Task<RateLimitResult> CheckAsync(
            string actorKey, string ip, string action, int limit, TimeSpan window, CancellationToken ct = default)
            => action == throwAction
                ? throw new InvalidOperationException("limiter unavailable (test double)")
                : Task.FromResult(RateLimitResult.Ok);
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

    private WebApplicationFactory<Program> Build(RecordingQueue queue, IRateLimiter? limiter = null) =>
        factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Demo:Enabled", "true");
            b.UseSetting("Demo:SnapshotKey", "");
            b.UseSetting("RateLimits:Enabled", "true");
            b.ConfigureTestServices(s =>
            {
                s.RemoveAll(typeof(IJobQueue));
                s.AddSingleton<IJobQueue>(queue);
                if (limiter is not null)
                {
                    s.RemoveAll(typeof(IRateLimiter));
                    s.AddSingleton(limiter);
                }
                s.AddSingleton<IStartupFilter>(new FakeIpStartupFilter(RandomIp()));
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

    // A fresh, healthy, brief-ready analysis (routing plan present, no
    // degradation notice, no demo version) owned by the guest.
    private static async Task<Guid> SeedAnalysisAsync(WebApplicationFactory<Program> f, Guid userId)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var jobId = Guid.NewGuid();
        var analysisId = Guid.NewGuid();
        db.AnalysisJobs.Add(new AnalysisJob { Id = jobId, UserId = userId, Status = "complete" });
        db.Analyses.Add(new Analysis
        {
            Id = analysisId, JobId = jobId, UserId = userId, FinalJson = "{}",
            RoutingPlan = """{"specialists_to_run":[],"skip":[],"rationale":"test"}""",
        });
        await db.SaveChangesAsync();
        return analysisId;
    }

    private static async Task<int> CoachGuestMessagesAsync(WebApplicationFactory<Program> f)
    {
        using var scope = f.Services.CreateScope();
        var ents = scope.ServiceProvider.GetRequiredService<EntitlementService>();
        return GuestLimits.Flag(await ents.GetFlagsAsync(CancellationToken.None), "coach_guest_messages", 20);
    }

    private static async Task<(int Messages, int Meter)> WrittenAsync(
        WebApplicationFactory<Program> f, Guid userId, Guid analysisId)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var messages = await db.CoachMessages.CountAsync(m =>
            m.Role == "user" && db.Conversations.Any(c => c.Id == m.ConversationId && c.AnalysisId == analysisId));
        var meter = await db.UsageEvents.CountAsync(e => e.UserId == userId && e.EventType == "coach_message");
        return (messages, meter);
    }

    private static async Task<string?> CodeAsync(HttpResponseMessage resp)
    {
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("error").GetProperty("code").GetString();
    }

    private static Task CleanupAsync(WebApplicationFactory<Program> f, params Guid[] userIds) =>
        DemoAuthEndpointsTests.CleanupAsync(f, userIds);

    // I2 — 30 parallel messages from a guest at 0/limit: exactly `limit` are
    // accepted and enqueued; the rest get the coach cap refusal and write
    // nothing.
    [SkippableFact]
    public async Task Thirty_Parallel_Guest_Messages_Accept_Exactly_The_Cap()
    {
        await TestDb.RequireAsync(factory);
        var queue = new RecordingQueue();
        var f = Build(queue);
        Guid guestId = default;
        try
        {
            var (client, uid) = await StartGuestAsync(f);
            guestId = uid;
            var analysisId = await SeedAnalysisAsync(f, guestId);
            var limit = await CoachGuestMessagesAsync(f);
            Skip.If(limit >= 30, "coach_guest_messages raised to 30+ — the burst cannot exceed it");

            var responses = await Task.WhenAll(Enumerable.Range(0, 30).Select(i =>
                client.PostAsJsonAsync($"/api/coach/{analysisId}/messages", new CreateCoachMessageRequest($"Q{i}"))));

            Assert.Equal(limit, responses.Count(r => r.StatusCode == HttpStatusCode.OK));
            var refused = responses.Where(r => r.StatusCode != HttpStatusCode.OK).ToList();
            Assert.Equal(30 - limit, refused.Count);
            foreach (var r in refused)
            {
                Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
                Assert.Equal("coach_cap_reached", await CodeAsync(r));
            }
            Assert.Equal(limit, queue.Count(DramatiqTasks.CoachReply));
            Assert.Equal((limit, limit), await WrittenAsync(f, guestId, analysisId));
        }
        finally { await CleanupAsync(f, guestId); f.Dispose(); }
    }

    // I2 — the limiter is unreachable: a guest message fails CLOSED (503) with
    // nothing written or enqueued. The coach BRIEF is not a guest message and
    // never touches this limiter, so it still goes through.
    [SkippableFact]
    public async Task Limiter_Failure_Is_503_With_Nothing_Written_And_The_Brief_Is_Untouched()
    {
        await TestDb.RequireAsync(factory);
        var queue = new RecordingQueue();
        var f = Build(queue, new ThrowOnActionLimiter("guest_coach"));
        Guid guestId = default;
        try
        {
            var (client, uid) = await StartGuestAsync(f);
            guestId = uid;
            var analysisId = await SeedAnalysisAsync(f, guestId);

            var resp = await client.PostAsJsonAsync(
                $"/api/coach/{analysisId}/messages", new CreateCoachMessageRequest("Hello"));
            Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
            Assert.Equal("demo_capacity", await CodeAsync(resp));
            Assert.Equal((0, 0), await WrittenAsync(f, guestId, analysisId));
            Assert.Equal(0, queue.Count(DramatiqTasks.CoachReply));

            var brief = await client.PostAsync($"/api/coach/{analysisId}/brief", null);
            Assert.Equal(HttpStatusCode.Accepted, brief.StatusCode);
            Assert.Equal(1, queue.Count(DramatiqTasks.CoachReply));
        }
        finally { await CleanupAsync(f, guestId); f.Dispose(); }
    }
}
