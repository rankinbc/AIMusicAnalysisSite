using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging.Abstractions;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using StackExchange.Redis;
using Xunit;

namespace Spectr.Bff.Tests;

// Fix wave FW1 (final review I1 + M6) — one guest upload charges one slot of
// `guest_uploads_max`, on the presigned path (init → parts → complete) and on
// the proxy path (POST /versions/), and an aborted upload gives its slot back.
// The upload slots live in real Redis; every OTHER limiter action passes
// (and is recorded), so these tests never spend the shared GLOBAL
// guest-analysis bucket that other suites and the dev stack also read.
[Collection("DemoAuth")]
public sealed class GuestUploadSlotTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private sealed class RecordingQueue : IJobQueue
    {
        public readonly ConcurrentQueue<string> Tasks = new();
        public Task EnqueueAsync(string t, object[] a, CancellationToken ct = default) { Tasks.Enqueue(t); return Task.CompletedTask; }
        public Task EnqueueAsync(string t, object[] a, string q, CancellationToken ct = default) { Tasks.Enqueue(t); return Task.CompletedTask; }
        public Task EnqueueDelayedAsync(string t, object[] a, string q, TimeSpan d, CancellationToken ct = default) { Tasks.Enqueue(t); return Task.CompletedTask; }
    }

    // `guest_upload` (the pre-FW1 upload limiter) is forwarded to the REAL
    // Redis limiter so the old double charge is observable; every other
    // action is allowed and recorded.
    private sealed class HybridLimiter(IRateLimiter real, ConcurrentQueue<string> actions) : IRateLimiter
    {
        public Task<RateLimitResult> CheckAsync(
            string actorKey, string ip, string action, int limit, TimeSpan window, CancellationToken ct = default)
        {
            actions.Enqueue(action);
            return action == "guest_upload"
                ? real.CheckAsync(actorKey, ip, action, limit, window, ct)
                : Task.FromResult(RateLimitResult.Ok);
        }
    }

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

    private sealed record Harness(
        WebApplicationFactory<Program> Factory, RecordingQueue Queue, ConcurrentQueue<string> Actions);

    private Harness Build()
    {
        var queue = new RecordingQueue();
        var actions = new ConcurrentQueue<string>();
        var f = factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Demo:Enabled", "true");
            b.UseSetting("Demo:SnapshotKey", "");
            b.UseSetting("RateLimits:Enabled", "true");
            b.ConfigureTestServices(s =>
            {
                s.RemoveAll(typeof(IJobQueue));
                s.AddSingleton<IJobQueue>(queue);
                s.RemoveAll(typeof(IRateLimiter));
                s.AddSingleton<IRateLimiter>(sp => new HybridLimiter(
                    new RedisRateLimiter(sp.GetRequiredService<IConnectionMultiplexer>()), actions));
                s.RemoveAll<IMultipartObjectStore>();
                s.AddSingleton<IMultipartObjectStore>(new FakeMultipartObjectStore());
                s.AddSingleton<IStartupFilter>(new FakeIpStartupFilter(RandomIp()));
            });
        });
        return new Harness(f, queue, actions);
    }

    private static async Task<(HttpClient Client, DemoStartResponse Demo)> StartGuestAsync(WebApplicationFactory<Program> f)
    {
        var client = f.CreateClient();
        var resp = await client.PostAsync("/api/auth/demo", null);
        resp.EnsureSuccessStatusCode();
        var body = (await resp.Content.ReadFromJsonAsync<DemoStartResponse>())!;
        client.DefaultRequestHeaders.Authorization = new("Bearer", body.AccessToken);
        return (client, body);
    }

    private sealed record Init(Guid JobId, string Key, string UploadId);

    private static Task<HttpResponseMessage> PostInitAsync(HttpClient c) =>
        c.PostAsJsonAsync("/api/uploads/init", new
        {
            fileName = "mix.wav", fileSize = 1024L * 1024, contentType = "audio/wav", songId = (string?)null,
        });

    private static async Task<Init> InitAsync(HttpClient c)
    {
        var resp = await PostInitAsync(c);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        var r = doc.RootElement;
        return new Init(r.GetProperty("jobId").GetGuid(), r.GetProperty("key").GetString()!, r.GetProperty("uploadId").GetString()!);
    }

    private static Task<HttpResponseMessage> CompleteAsync(HttpClient c, Init i, bool? analyze = null) =>
        c.PostAsJsonAsync("/api/uploads/complete", new
        {
            jobId = i.JobId, key = i.Key, uploadId = i.UploadId,
            parts = new[] { new { partNumber = 1, eTag = "\"etag-1\"" } },
            songId = (string?)null, genreHint = (string?)null, analyze,
        });

    private static Task<HttpResponseMessage> AbortAsync(HttpClient c, Init i) =>
        c.PostAsJsonAsync("/api/uploads/abort", new { key = i.Key, uploadId = i.UploadId });

    private static MultipartFormDataContent Wav(string name, bool empty = false)
    {
        var form = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(empty ? [] : DemoSeeder.GenerateToneWav());
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        form.Add(fileContent, "file", name);
        form.Add(new StringContent("false"), "analyze");
        return form;
    }

    private static async Task<int> UploadsUsedAsync(HttpClient c)
        => (await c.GetFromJsonAsync<GuestStateDto>("/api/me/guest"))!.UploadsUsed;

    // The guest's upload slots as the atomic guard holds them (lapsed
    // entries excluded).
    private static Task<long> SlotsHeldAsync(WebApplicationFactory<Program> f, Guid userId)
        => f.Services.GetRequiredService<IGuestSlots>().CountAsync(GuestLimits.UploadSlotsKey(userId));

    private static async Task<(string? Code, string? Reason)> ErrorAsync(HttpResponseMessage resp)
    {
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        var err = doc.RootElement.GetProperty("error");
        var reason = err.TryGetProperty("details", out var d) && d.ValueKind == JsonValueKind.Object
            && d.TryGetProperty("reason", out var r) ? r.GetString() : null;
        return (err.GetProperty("code").GetString(), reason);
    }

    private static int Count(ConcurrentQueue<string> q, string item) => q.Count(x => x == item);

    private static Task CleanupAsync(WebApplicationFactory<Program> f, params Guid[] userIds) =>
        DemoAuthEndpointsTests.CleanupAsync(f, userIds);

    // I1 — two presigned uploads both succeed (init + complete = ONE slot
    // each); the third init is refused before any bytes move. The guest
    // analysis arms are charged once per upload: at init, and the dispatch
    // for that upload (at /complete, or a later /analyze) spends that charge
    // instead of charging again.
    [SkippableFact]
    public async Task Two_Presigned_Uploads_Succeed_The_Third_Init_Is_Refused_And_The_Arms_Charge_Once_Each()
    {
        await TestDb.RequireAsync(factory);
        var h = Build();
        Guid guestId = default;
        try
        {
            var (client, g) = await StartGuestAsync(h.Factory);
            guestId = g.User.Id;

            var a = await InitAsync(client);
            Assert.Equal(0, await UploadsUsedAsync(client));
            var ca = await CompleteAsync(client, a); // analyze defaults to true
            Assert.Equal(HttpStatusCode.OK, ca.StatusCode);
            Assert.Equal(1, Count(h.Queue.Tasks, DramatiqTasks.AnalyzeAudioJob));
            Assert.Equal(1, await UploadsUsedAsync(client));
            Assert.Equal((1, 1), (Count(h.Actions, "guest_analysis_ip"), Count(h.Actions, "guest_analysis")));

            var b = await InitAsync(client);
            Assert.Equal(2, await SlotsHeldAsync(h.Factory, guestId)); // A completed + B pending
            var cb = await CompleteAsync(client, b, analyze: false);
            Assert.Equal(HttpStatusCode.OK, cb.StatusCode);
            var versionB = (await cb.Content.ReadFromJsonAsync<UploadResponse>())!.VersionId;
            Assert.Equal(2, await UploadsUsedAsync(client));
            var an = await client.PostAsync($"/api/versions/{versionB}/analyze", null);
            Assert.Equal(HttpStatusCode.Accepted, an.StatusCode);
            Assert.Equal(2, Count(h.Queue.Tasks, DramatiqTasks.AnalyzeAudioJob));
            Assert.Equal((2, 2), (Count(h.Actions, "guest_analysis_ip"), Count(h.Actions, "guest_analysis")));

            var third = await PostInitAsync(client);
            Assert.Equal(HttpStatusCode.Forbidden, third.StatusCode);
            Assert.Equal(("guest_restricted", "upload_limit"), await ErrorAsync(third));
            Assert.Equal((2, 2), (Count(h.Actions, "guest_analysis_ip"), Count(h.Actions, "guest_analysis")));
            Assert.Equal(2, await UploadsUsedAsync(client));
            Assert.Equal(2, await SlotsHeldAsync(h.Factory, guestId));
        }
        finally { await CleanupAsync(h.Factory, guestId); h.Factory.Dispose(); }
    }

    // I1 — init → abort gives the slot back: two more full uploads still fit,
    // and the state endpoint and the slot guard agree after the abort and
    // after each upload.
    [SkippableFact]
    public async Task An_Aborted_Upload_Gives_Its_Slot_Back()
    {
        await TestDb.RequireAsync(factory);
        var h = Build();
        Guid guestId = default;
        try
        {
            var (client, g) = await StartGuestAsync(h.Factory);
            guestId = g.User.Id;

            var aborted = await InitAsync(client);
            Assert.Equal(HttpStatusCode.NoContent, (await AbortAsync(client, aborted)).StatusCode);
            Assert.Equal(0, await UploadsUsedAsync(client));
            Assert.Equal(0, await SlotsHeldAsync(h.Factory, guestId));

            var b = await InitAsync(client);
            Assert.Equal(HttpStatusCode.OK, (await CompleteAsync(client, b, analyze: false)).StatusCode);
            Assert.Equal((1, 1L), (await UploadsUsedAsync(client), await SlotsHeldAsync(h.Factory, guestId)));

            var c = await InitAsync(client);
            Assert.Equal(HttpStatusCode.OK, (await CompleteAsync(client, c, analyze: false)).StatusCode);
            Assert.Equal((2, 2L), (await UploadsUsedAsync(client), await SlotsHeldAsync(h.Factory, guestId)));

            // A late abort of a COMPLETED upload never refunds it.
            Assert.Equal(HttpStatusCode.NoContent, (await AbortAsync(client, c)).StatusCode);
            var over = await PostInitAsync(client);
            Assert.Equal(HttpStatusCode.Forbidden, over.StatusCode);
            Assert.Equal(("guest_restricted", "upload_limit"), await ErrorAsync(over));
        }
        finally { await CleanupAsync(h.Factory, guestId); h.Factory.Dispose(); }
    }

    // I1 — /complete needs a slot charged by this guest's own /init for that
    // very upload: an unknown upload id, and a second /complete of an upload
    // already completed, are refused without creating a version.
    [SkippableFact]
    public async Task Complete_Without_A_Charged_Init_Is_Refused()
    {
        await TestDb.RequireAsync(factory);
        var h = Build();
        Guid guestId = default;
        try
        {
            var (client, g) = await StartGuestAsync(h.Factory);
            guestId = g.User.Id;

            var jobId = Guid.NewGuid();
            var forged = new Init(jobId, $"audio/{guestId}/{jobId}/source.wav", "upload-forged");
            var r1 = await CompleteAsync(client, forged, analyze: false);
            Assert.Equal(HttpStatusCode.Conflict, r1.StatusCode);
            Assert.Equal("upload_not_started", (await ErrorAsync(r1)).Code);
            Assert.Equal(0, await UploadsUsedAsync(client));

            var a = await InitAsync(client);
            Assert.Equal(HttpStatusCode.OK, (await CompleteAsync(client, a, analyze: false)).StatusCode);
            var again = await CompleteAsync(client, a, analyze: false);
            Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
            Assert.Equal("upload_not_started", (await ErrorAsync(again)).Code);
            Assert.Equal((1, 1L), (await UploadsUsedAsync(client), await SlotsHeldAsync(h.Factory, guestId)));
        }
        finally { await CleanupAsync(h.Factory, guestId); h.Factory.Dispose(); }
    }

    // I1 — the proxy path charges one slot per upload that lands a version:
    // a request refused before any version row (empty file) gives its slot
    // back, two real uploads succeed, the third is refused.
    [SkippableFact]
    public async Task Proxy_Path_Two_Uploads_Then_Refused_And_A_Failed_Request_Costs_Nothing()
    {
        await TestDb.RequireAsync(factory);
        var h = Build();
        Guid guestId = default;
        try
        {
            var (client, g) = await StartGuestAsync(h.Factory);
            guestId = g.User.Id;

            var bad = await client.PostAsync("/api/versions/", Wav("empty.wav", empty: true));
            Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
            Assert.Equal((0, 0L), (await UploadsUsedAsync(client), await SlotsHeldAsync(h.Factory, guestId)));

            Assert.Equal(HttpStatusCode.OK, (await client.PostAsync("/api/versions/", Wav("one.wav"))).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.PostAsync("/api/versions/", Wav("two.wav"))).StatusCode);
            Assert.Equal((2, 2L), (await UploadsUsedAsync(client), await SlotsHeldAsync(h.Factory, guestId)));

            var third = await client.PostAsync("/api/versions/", Wav("three.wav"));
            Assert.Equal(HttpStatusCode.Forbidden, third.StatusCode);
            Assert.Equal(("guest_restricted", "upload_limit"), await ErrorAsync(third));
            Assert.Equal(2, await UploadsUsedAsync(client));
        }
        finally { await CleanupAsync(h.Factory, guestId); h.Factory.Dispose(); }
    }

    // I1 — parallel inits racing for the LAST slot: exactly one wins.
    [SkippableFact]
    public async Task Parallel_Inits_At_The_Last_Slot_Exactly_One_Wins()
    {
        await TestDb.RequireAsync(factory);
        var h = Build();
        Guid guestId = default;
        try
        {
            var (client, g) = await StartGuestAsync(h.Factory);
            guestId = g.User.Id;

            var first = await InitAsync(client);
            Assert.Equal(HttpStatusCode.OK, (await CompleteAsync(client, first, analyze: false)).StatusCode);

            var racers = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => PostInitAsync(client)));
            Assert.Equal(1, racers.Count(r => r.StatusCode == HttpStatusCode.OK));
            Assert.Equal(5, racers.Count(r => r.StatusCode == HttpStatusCode.Forbidden));
            Assert.Equal(2, await SlotsHeldAsync(h.Factory, guestId));
        }
        finally { await CleanupAsync(h.Factory, guestId); h.Factory.Dispose(); }
    }

    // M6 — a flags or DB-count failure inside CheckUploadAsync answers the
    // friendly 503 (fail closed), never a raw 500. DB-free: the context
    // points at a closed port.
    [Theory]
    [InlineData(false)] // the feature-flag read fails
    [InlineData(true)]  // flags come from cache; the DB count fails
    public async Task Check_Upload_Flag_Or_Db_Failure_Is_A_Friendly_503(bool flagsCached)
    {
        var dead = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql("Host=127.0.0.1;Port=1;Database=none;Username=none;Timeout=3").Options;
        await using var db = new AppDbContext(dead);
        var cache = new MemoryCache(new MemoryCacheOptions());
        if (flagsCached)
            cache.Set("feature_flags_global", new Dictionary<string, string> { ["guest_uploads_max"] = "2" });
        var cfg = factory.Services.GetRequiredService<IConfiguration>();
        var ents = new EntitlementService(db, cache, cfg, NullLogger<EntitlementService>.Instance);
        var limits = ActivatorUtilities.CreateInstance<GuestLimits>(factory.Services, db, ents);

        var result = await limits.CheckUploadAsync(Guid.NewGuid(), CancellationToken.None);

        Assert.NotNull(result);
        var http = new DefaultHttpContext { RequestServices = factory.Services };
        http.Response.Body = new MemoryStream();
        await result!.ExecuteAsync(http);
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, http.Response.StatusCode);
        http.Response.Body.Position = 0;
        using var doc = await JsonDocument.ParseAsync(http.Response.Body);
        Assert.Equal("demo_capacity", doc.RootElement.GetProperty("error").GetProperty("code").GetString());
    }
}
