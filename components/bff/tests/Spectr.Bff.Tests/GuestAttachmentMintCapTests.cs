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
using Spectr.Bff.Endpoints;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using Xunit;

namespace Spectr.Bff.Tests;

// Task G1 fix round 1 item 3 (Opus review of 665b39f + c78ee3d): presigned
// uploads escape every byte cap — the attachments/init mint counts only
// REGISTERED entries and mints a fresh random id per call, and the reference/
// als branches had no guest cap at all. Reuses FakeMultipartObjectStore from
// UploadEndpointsTests.cs (internal, same assembly). Shares the "DemoAuth"
// collection with the other demo-auth suites.
[Collection("DemoAuth")]
public sealed class GuestAttachmentMintCapTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private sealed class RecordingActionLimiter : IRateLimiter
    {
        public readonly List<string> Actions = [];
        public string? ThrowAction;
        public Task<RateLimitResult> CheckAsync(
            string actorKey, string ip, string action, int limit, TimeSpan window, CancellationToken ct = default)
        {
            Actions.Add(action);
            if (action == ThrowAction) throw new InvalidOperationException("limiter unavailable (test double)");
            return Task.FromResult(RateLimitResult.Ok);
        }
    }

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

    private (WebApplicationFactory<Program> Factory, FakeMultipartObjectStore Store) Build(
        IRateLimiter? limiter = null, bool rateLimits = false, bool fakeIp = false)
    {
        var store = new FakeMultipartObjectStore();
        var f = factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Demo:Enabled", "true");
            b.UseSetting("Demo:SnapshotKey", "");
            if (rateLimits) b.UseSetting("RateLimits:Enabled", "true");
            b.ConfigureTestServices(s =>
            {
                s.RemoveAll<IMultipartObjectStore>();
                s.AddSingleton<IMultipartObjectStore>(store);
                if (limiter is not null)
                {
                    s.RemoveAll(typeof(IRateLimiter));
                    s.AddSingleton(limiter);
                }
                if (fakeIp)
                    s.AddSingleton<Microsoft.AspNetCore.Hosting.IStartupFilter>(new FakeIpStartupFilter(RandomIp()));
            });
        });
        return (f, store);
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

    // The seeded demo version's key (audio/demo/source.wav) has no AR20
    // jobId segment, so attachments/init 501s on it. A presignable version
    // needs the real audio/{userId}/{jobId}/source.* shape.
    private static async Task<Guid> SeedPresignableVersionAsync(WebApplicationFactory<Program> f, Guid userId)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var jobId = Guid.NewGuid();
        var song = new Song { Id = Guid.NewGuid(), UserId = userId, Name = "Mint cap test" };
        var version = new SongVersion
        {
            Id = Guid.NewGuid(), SongId = song.Id,
            FilePath = $"audio/{userId}/{jobId}/source.wav", VersionNumber = 1,
        };
        db.Songs.Add(song);
        db.SongVersions.Add(version);
        await db.SaveChangesAsync();
        return version.Id;
    }

    private static async Task<Guid> SeedReferenceAsync(WebApplicationFactory<Program> f, Guid userId)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var row = new ReferenceTrack
        {
            Id = Guid.NewGuid(), UserId = userId, Title = "Mint cap ref",
            FilePath = "audio/reference/mintcap/source.wav",
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

    [SkippableFact]
    public async Task Mint_Budget_Blocks_The_Thirty_First_Init_And_Mints_No_Url()
    {
        await TestDb.RequireAsync(factory);
        var (f, store) = Build(rateLimits: true, fakeIp: true);
        Guid guestId = default;
        try
        {
            var (client, g) = await StartGuestAsync(f);
            guestId = g.User.Id;
            var versionId = await SeedPresignableVersionAsync(f, guestId);

            // guest_attachment_mints_max seeds 30.
            for (var i = 0; i < 30; i++)
            {
                var r = await client.PostAsJsonAsync("/api/uploads/attachments/init",
                    new { kind = "als", versionId, fileName = "project.als", fileSize = 1000L });
                Assert.Equal(HttpStatusCode.OK, r.StatusCode);
            }
            Assert.Equal(30, store.PresignedPuts.Count);

            var r31 = await client.PostAsJsonAsync("/api/uploads/attachments/init",
                new { kind = "als", versionId, fileName = "project.als", fileSize = 1000L });
            Assert.Equal(HttpStatusCode.Forbidden, r31.StatusCode);
            Assert.Equal("guest_restricted", await Code(r31));
            Assert.Equal(30, store.PresignedPuts.Count); // no 31st URL minted
        }
        finally { await CleanupAsync(f, guestId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task Mint_Budget_Limiter_Exception_Fails_Closed_503_And_Mints_No_Url()
    {
        await TestDb.RequireAsync(factory);
        var limiter = new RecordingActionLimiter { ThrowAction = "guest_attach_init" };
        var (f, store) = Build(limiter: limiter, rateLimits: true, fakeIp: true);
        Guid guestId = default;
        try
        {
            var (client, g) = await StartGuestAsync(f);
            guestId = g.User.Id;
            var versionId = await SeedPresignableVersionAsync(f, guestId);

            var resp = await client.PostAsJsonAsync("/api/uploads/attachments/init",
                new { kind = "als", versionId, fileName = "project.als", fileSize = 1000L });
            Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
            Assert.Equal("demo_capacity", await Code(resp));
            Assert.Empty(store.PresignedPuts);
        }
        finally { await CleanupAsync(f, guestId); f.Dispose(); }
    }

    [SkippableFact]
    public async Task Reference_Init_Also_Enforces_The_Reference_Count_Cap()
    {
        await TestDb.RequireAsync(factory);
        var (f, store) = Build();
        Guid guestId = default;
        try
        {
            var (client, g) = await StartGuestAsync(f);
            guestId = g.User.Id;
            await SeedReferenceAsync(f, guestId); // guest already at guest_references_max (1)

            var resp = await client.PostAsJsonAsync("/api/uploads/attachments/init",
                new { kind = "reference", versionId = (Guid?)null, fileName = "ref.wav", fileSize = 1000L });
            Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
            Assert.Equal("guest_restricted", await Code(resp));
            Assert.Equal("reference_limit", await Reason(resp));
            Assert.Empty(store.PresignedPuts);
        }
        finally { await CleanupAsync(f, guestId); f.Dispose(); }
    }

    // ── SumStemBytesAsync object-store fallback (via StageStemKeys) ──────────

    [SkippableFact]
    public async Task Existing_Object_Store_Only_Stems_Count_Toward_The_Guest_Byte_Cap()
    {
        await TestDb.RequireAsync(factory);
        // Every key "exists" only in the fake object store (never on local
        // IFileStorage) — this is exactly the presigned stage-keys shape.
        var (f, store) = Build();
        store.ObjectSize = 250L * 1024 * 1024; // 250 MB per object
        Guid guestId = default;
        try
        {
            var (client, g) = await StartGuestAsync(f);
            guestId = g.User.Id;
            var versionId = await SeedPresignableVersionAsync(f, guestId);
            var jobId = UploadEndpoints.JobIdFromSourceKey(
                (await GetVersionFilePathAsync(f, versionId)))!.Value;

            var first = await client.PostAsJsonAsync($"/api/versions/{versionId}/stems/stage-keys", new
            {
                stems = new[] { new { key = $"stems/{jobId}/one.wav", fileName = "one.wav", stemId = "" } },
            });
            Assert.Equal(HttpStatusCode.OK, first.StatusCode);

            // A second 250 MB object on top of the first's (now correctly
            // counted) 250 MB existing would total 500 MB > the 300 MB cap.
            var second = await client.PostAsJsonAsync($"/api/versions/{versionId}/stems/stage-keys", new
            {
                stems = new[] { new { key = $"stems/{jobId}/two.wav", fileName = "two.wav", stemId = "" } },
            });
            Assert.Equal(HttpStatusCode.Forbidden, second.StatusCode);
            Assert.Equal("stems_limit", await Reason(second));
        }
        finally { await CleanupAsync(f, guestId); f.Dispose(); }
    }

    private static async Task<string?> GetVersionFilePathAsync(WebApplicationFactory<Program> f, Guid versionId)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.SongVersions.AsNoTracking()
            .Where(v => v.Id == versionId).Select(v => v.FilePath).FirstOrDefaultAsync();
    }
}
