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

// Task G1 fix round 1 item 2 (Opus review of 665b39f + c78ee3d): two
// enqueueing routes guests can now reach had no per-guest cap, and stems
// classify hardcoded the paid lane. Shares the "DemoAuth" collection with
// the other demo-auth suites — they all read/count the SHARED users.is_guest
// rows and must not run in parallel.
[Collection("DemoAuth")]
public sealed class GuestClassifyAndReferenceAnalyzeCapTests(WebApplicationFactory<Program> factory)
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

    // Pattern: GuestCapsTests.RecordingActionLimiter.
    private sealed class RecordingActionLimiter : IRateLimiter
    {
        public readonly List<string> Actions = [];
        public string? ThrowAction;
        private string? DenyAction => null; // unused in this file — kept only for CheckAsync's shape
        public Task<RateLimitResult> CheckAsync(
            string actorKey, string ip, string action, int limit, TimeSpan window, CancellationToken ct = default)
        {
            Actions.Add(action);
            if (action == ThrowAction) throw new InvalidOperationException("limiter unavailable (test double)");
            if (action == DenyAction) return Task.FromResult(new RateLimitResult(false, window));
            return Task.FromResult(RateLimitResult.Ok);
        }
    }

    // Pattern: GuestCapsTests.FakeIpStartupFilter — a distinct IP per Build()
    // so this suite's `demo_create` bucket never collides with another run.
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
        var email = $"classifycap+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync("/api/auth/register", new { email, password = "correct-horse-battery" });
        reg.EnsureSuccessStatusCode();
        var auth = await reg.Content.ReadFromJsonAsync<Spectr.Bff.DTOs.AuthResponse>();
        client.DefaultRequestHeaders.Authorization = new("Bearer", auth!.AccessToken);
        return (client, auth.User.Id);
    }

    // Seeds a version + owning song for a real (non-guest) user, so the
    // real-user half of the lane test has something to classify against.
    private static async Task<Guid> SeedVersionAsync(WebApplicationFactory<Program> f, Guid userId)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var song = new Song { Id = Guid.NewGuid(), UserId = userId, Name = "Classify cap test" };
        var version = new SongVersion
        {
            Id = Guid.NewGuid(), SongId = song.Id, FilePath = "audio/classifycap/x.wav", VersionNumber = 1,
        };
        db.Songs.Add(song);
        db.SongVersions.Add(version);
        await db.SaveChangesAsync();
        return version.Id;
    }

    // Directly inserts a ReferenceTrack row (bypasses the upload cap — the
    // analyze cap under test is independent of how the row got there).
    private static async Task<Guid> SeedReferenceAsync(WebApplicationFactory<Program> f, Guid userId)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var row = new ReferenceTrack
        {
            Id = Guid.NewGuid(), UserId = userId, Title = "Classify cap ref",
            FilePath = "audio/reference/classifycap/source.wav",
        };
        db.ReferenceTracks.Add(row);
        await db.SaveChangesAsync();
        return row.Id;
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

    private static Task CleanupAsync(WebApplicationFactory<Program> f, params Guid[] userIds) =>
        DemoAuthEndpointsTests.CleanupAsync(f, userIds);

    // ── stems/classify ────────────────────────────────────────────────────

    [SkippableFact]
    public async Task Classify_Cap_Blocks_The_Seventh_Call_And_Enqueues_Nothing_More()
    {
        await TestDb.RequireAsync(factory);
        var queue = new RecordingQueue();
        var f = Build(queue, rateLimits: true, fakeIp: true);
        Guid guestId = default;
        try
        {
            var (client, g) = await StartGuestAsync(f);
            guestId = g.User.Id;

            // guest_classify_max seeds 6.
            for (var i = 0; i < 6; i++)
            {
                var r = await client.PostAsync($"/api/versions/{g.Demo.VersionId}/stems/classify", null);
                Assert.Equal(HttpStatusCode.Accepted, r.StatusCode);
            }
            Assert.Equal(6, queue.Sent.Count(s => s.Task == DramatiqTasks.ClassifyStems));

            var r7 = await client.PostAsync($"/api/versions/{g.Demo.VersionId}/stems/classify", null);
            Assert.Equal(HttpStatusCode.Forbidden, r7.StatusCode);
            Assert.Equal("guest_restricted", await Code(r7));
            Assert.Equal("classify_limit", await Reason(r7));
            Assert.Equal(6, queue.Sent.Count(s => s.Task == DramatiqTasks.ClassifyStems));
        }
        finally { await CleanupAsync(f, guestId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task Classify_Limiter_Exception_Fails_Closed_503_And_Enqueues_Nothing()
    {
        await TestDb.RequireAsync(factory);
        var queue = new RecordingQueue();
        var limiter = new RecordingActionLimiter { ThrowAction = "guest_classify" };
        var f = Build(queue, limiter: limiter, rateLimits: true, fakeIp: true);
        Guid guestId = default;
        try
        {
            var (client, g) = await StartGuestAsync(f);
            guestId = g.User.Id;

            var resp = await client.PostAsync($"/api/versions/{g.Demo.VersionId}/stems/classify", null);
            Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
            Assert.Equal("demo_capacity", await Code(resp));
            Assert.Empty(queue.Sent);
        }
        finally { await CleanupAsync(f, guestId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task Guest_Classify_Lands_On_Analysis_Free_Real_User_Stays_On_Analysis_Paid()
    {
        await TestDb.RequireAsync(factory);
        var queue = new RecordingQueue();
        var f = Build(queue);
        Guid guestId = default, realUserId = default;
        try
        {
            var (guestClient, g) = await StartGuestAsync(f);
            guestId = g.User.Id;
            var guestResp = await guestClient.PostAsync($"/api/versions/{g.Demo.VersionId}/stems/classify", null);
            Assert.Equal(HttpStatusCode.Accepted, guestResp.StatusCode);
            Assert.Contains(queue.Sent, s => s.Task == DramatiqTasks.ClassifyStems && s.Queue == DramatiqQueues.AnalysisFree);

            var (realClient, uid) = await RegisterRealUserAsync(f);
            realUserId = uid;
            var realVersionId = await SeedVersionAsync(f, realUserId);
            queue.Sent.Clear();
            var realResp = await realClient.PostAsync($"/api/versions/{realVersionId}/stems/classify", null);
            Assert.Equal(HttpStatusCode.Accepted, realResp.StatusCode);
            Assert.Contains(queue.Sent, s => s.Task == DramatiqTasks.ClassifyStems && s.Queue == DramatiqQueues.AnalysisPaid);
        }
        finally { await CleanupAsync(f, guestId, realUserId); f.Dispose(); }
    }

    // ── references/{id}/analyze ──────────────────────────────────────────────

    [SkippableFact]
    public async Task Reference_Analyze_Cap_Blocks_The_Fourth_Call_And_Enqueues_Nothing_More()
    {
        await TestDb.RequireAsync(factory);
        var queue = new RecordingQueue();
        var f = Build(queue, rateLimits: true, fakeIp: true);
        Guid guestId = default;
        try
        {
            var (client, g) = await StartGuestAsync(f);
            guestId = g.User.Id;
            var refId = await SeedReferenceAsync(f, guestId);

            // guest_ref_analyze_max seeds 3.
            for (var i = 0; i < 3; i++)
            {
                var r = await client.PostAsync($"/api/references/{refId}/analyze", null);
                Assert.Equal(HttpStatusCode.Accepted, r.StatusCode);
            }
            Assert.Equal(3, queue.Sent.Count(s => s.Task == DramatiqTasks.RunReferenceAnalyzer));

            var r4 = await client.PostAsync($"/api/references/{refId}/analyze", null);
            Assert.Equal(HttpStatusCode.Forbidden, r4.StatusCode);
            Assert.Equal("guest_restricted", await Code(r4));
            Assert.Equal("reference_analyze_limit", await Reason(r4));
            Assert.Equal(3, queue.Sent.Count(s => s.Task == DramatiqTasks.RunReferenceAnalyzer));
        }
        finally { await CleanupAsync(f, guestId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task Reference_Analyze_Limiter_Exception_Fails_Closed_503_And_Enqueues_Nothing()
    {
        await TestDb.RequireAsync(factory);
        var queue = new RecordingQueue();
        var limiter = new RecordingActionLimiter { ThrowAction = "guest_ref_analyze" };
        var f = Build(queue, limiter: limiter, rateLimits: true, fakeIp: true);
        Guid guestId = default;
        try
        {
            var (client, g) = await StartGuestAsync(f);
            guestId = g.User.Id;
            var refId = await SeedReferenceAsync(f, guestId);

            var resp = await client.PostAsync($"/api/references/{refId}/analyze", null);
            Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
            Assert.Equal("demo_capacity", await Code(resp));
            Assert.Empty(queue.Sent);
        }
        finally { await CleanupAsync(f, guestId); f.Dispose(); }
    }
}
