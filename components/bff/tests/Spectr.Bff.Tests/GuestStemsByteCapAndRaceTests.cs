using System.Data.Common;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using Xunit;

namespace Spectr.Bff.Tests;

// Task G1 fix round 1 item 4 (Opus review of 665b39f + c78ee3d): the guest
// stems/reference caps ran AFTER the multipart body was already buffered,
// and parallel stems/stage calls raced each other's read-then-write on
// song_versions.stem_paths_raw. Shares the "DemoAuth" collection with the
// other demo-auth suites.
[Collection("DemoAuth")]
public sealed class GuestStemsByteCapAndRaceTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    // Throws for the lock-unavailable test — a fake at the IDistributedLock
    // seam rather than the whole StackExchange.Redis IConnectionMultiplexer
    // surface (same reasoning as RecordingActionLimiter for IRateLimiter).
    private sealed class ThrowingDistributedLock : IDistributedLock
    {
        public Task<string?> TryAcquireAsync(string key, TimeSpan ttl, CancellationToken ct = default)
            => throw new InvalidOperationException("redis unavailable (test double)");
        public Task ReleaseAsync(string key, string token, CancellationToken ct = default)
            => Task.CompletedTask;
    }

    // Task G7a (R3a) — another guest request (or this same guest's own
    // concurrent call) already holds the lock: acquire returns "not
    // acquired" (never throws). ReleaseAsync throws if it is EVER called —
    // proving the handler never releases a lock it never acquired (which
    // would free a foreign token it does not own).
    private sealed class HeldDistributedLock : IDistributedLock
    {
        public Task<string?> TryAcquireAsync(string key, TimeSpan ttl, CancellationToken ct = default)
            => Task.FromResult<string?>(null);
        public Task ReleaseAsync(string key, string token, CancellationToken ct = default)
            => throw new InvalidOperationException("must never release a lock this request never acquired");
    }

    private WebApplicationFactory<Program> Build(IDistributedLock? distLock = null) =>
        factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Demo:Enabled", "true");
            b.UseSetting("Demo:SnapshotKey", "");
            if (distLock is not null)
            {
                b.ConfigureTestServices(s =>
                {
                    s.RemoveAll<IDistributedLock>();
                    s.AddSingleton(distLock);
                });
            }
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

    // A version with NO staged stems yet (existingBytes = 0), owned by the
    // guest — distinct from the seeded demo version so tests don't fight
    // over its stem list.
    private static async Task<Guid> SeedEmptyVersionAsync(WebApplicationFactory<Program> f, Guid userId)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var song = new Song { Id = Guid.NewGuid(), UserId = userId, Name = "Byte cap test" };
        var version = new SongVersion
        {
            Id = Guid.NewGuid(), SongId = song.Id, FilePath = "audio/bytecap/x.wav", VersionNumber = 1,
        };
        db.Songs.Add(song);
        db.SongVersions.Add(version);
        await db.SaveChangesAsync();
        return version.Id;
    }

    private static MultipartFormDataContent OneStem(string name)
    {
        var form = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(DemoSeeder.GenerateToneWav());
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        form.Add(fileContent, "file", name);
        return form;
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

    // ── item 4(a): Content-Length precheck, before the form is read ─────────

    [SkippableFact]
    public async Task Guest_Stems_Stage_Over_The_Byte_Budget_Is_Refused_Without_Reading_The_Body()
    {
        await TestDb.RequireAsync(factory);
        using var f = Build();
        var (client, demo) = await StartGuestAsync(f);
        var guestId = demo.User.Id;
        try
        {
            var versionId = await SeedEmptyVersionAsync(f, guestId);

            // The ACTUAL body is a few hundred bytes and is not even valid
            // multipart — if the handler ever tries to parse it (the
            // pre-fix bug), that is a protocol-level failure, not a clean
            // 403. The declared Content-Length (500 MB) is what the fixed
            // handler must act on, BEFORE any read of the body.
            var content = new ByteArrayContent(new byte[256]);
            content.Headers.ContentType = new MediaTypeHeaderValue("multipart/form-data")
            {
                Parameters = { new NameValueHeaderValue("boundary", "x") },
            };
            content.Headers.ContentLength = 500L * 1024 * 1024;
            var req = new HttpRequestMessage(HttpMethod.Post, $"/api/versions/{versionId}/stems/stage")
            {
                Content = content,
            };
            var resp = await client.SendAsync(req);

            Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
            Assert.Equal("guest_restricted", await Code(resp));
            Assert.Equal("stems_limit", await Reason(resp));
        }
        finally { await CleanupAsync(f, guestId); }
    }

    [SkippableFact]
    public async Task Guest_Reference_Upload_Over_The_Size_Ceiling_Is_Refused_Without_Reading_The_Body()
    {
        await TestDb.RequireAsync(factory);
        using var f = Build();
        var (client, demo) = await StartGuestAsync(f);
        var guestId = demo.User.Id;
        try
        {
            var content = new ByteArrayContent(new byte[256]);
            content.Headers.ContentType = new MediaTypeHeaderValue("multipart/form-data")
            {
                Parameters = { new NameValueHeaderValue("boundary", "x") },
            };
            content.Headers.ContentLength = 500L * 1024 * 1024; // over the 250 MB ceiling
            var req = new HttpRequestMessage(HttpMethod.Post, "/api/references/") { Content = content };
            var resp = await client.SendAsync(req);

            Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
            Assert.Equal("guest_restricted", await Code(resp));
            Assert.Equal("reference_limit", await Reason(resp));
        }
        finally { await CleanupAsync(f, guestId); }
    }

    // Task G7a (R1) — an at-cap guest's reference upload is refused BEFORE
    // the multipart form is read. Same "body the handler must never
    // successfully parse" seam as the Content-Length precheck test above:
    // if CheckReferenceAsync ran AFTER ReadFormAsync (the pre-fix order),
    // the handler would try to parse this deliberately-invalid multipart
    // body first and blow up instead of answering a clean 403.
    [SkippableFact]
    public async Task Guest_Reference_Upload_At_Cap_Is_Refused_Without_Reading_The_Body()
    {
        await TestDb.RequireAsync(factory);
        using var f = Build();
        var (client, demo) = await StartGuestAsync(f);
        var guestId = demo.User.Id;
        try
        {
            // guest_references_max defaults to 1 — one row puts this guest at cap.
            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.ReferenceTracks.Add(new ReferenceTrack { Id = Guid.NewGuid(), UserId = guestId, Title = "Existing" });
                await db.SaveChangesAsync();
            }

            var content = new ByteArrayContent(new byte[256]);
            content.Headers.ContentType = new MediaTypeHeaderValue("multipart/form-data")
            {
                Parameters = { new NameValueHeaderValue("boundary", "x") },
            };
            content.Headers.ContentLength = 256; // under the size ceiling — only the COUNT cap should trip
            var req = new HttpRequestMessage(HttpMethod.Post, "/api/references/") { Content = content };
            var resp = await client.SendAsync(req);

            Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
            Assert.Equal("guest_restricted", await Code(resp));
            Assert.Equal("reference_limit", await Reason(resp));
        }
        finally { await CleanupAsync(f, guestId); }
    }

    // ── item 4(b): a Redis lock serialises one guest's stage calls ──────────

    [SkippableFact]
    public async Task Six_Parallel_Guest_Stage_Calls_Never_Exceed_The_File_Cap()
    {
        await TestDb.RequireAsync(factory);
        using var f = Build(); // default DI: the REAL RedisDistributedLock (dev Redis)
        var (client, demo) = await StartGuestAsync(f);
        var guestId = demo.User.Id;
        try
        {
            var versionId = await SeedEmptyVersionAsync(f, guestId);

            // guest_stems_max_files seeds 12. Six parallel calls of 3 files
            // each = 18 attempted — without serialisation every call reads
            // the SAME "0 existing" and all pass their own 0+3<=12 check.
            var tasks = Enumerable.Range(0, 6).Select(async i =>
            {
                var form = new MultipartFormDataContent();
                for (var j = 0; j < 3; j++)
                {
                    var fileContent = new ByteArrayContent(DemoSeeder.GenerateToneWav());
                    fileContent.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
                    form.Add(fileContent, "file", $"race-{i}-{j}.wav");
                }
                return await client.PostAsync($"/api/versions/{versionId}/stems/stage", form);
            }).ToArray();
            await Task.WhenAll(tasks);

            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var raw = await db.SongVersions.AsNoTracking()
                .Where(v => v.Id == versionId).Select(v => v.StemPathsRaw).FirstOrDefaultAsync();
            var entries = Spectr.Bff.Endpoints.VersionEndpoints.ReadRaw(raw);
            Assert.True(entries.Count <= 12, $"expected at most 12 staged stems, got {entries.Count}");
        }
        finally { await CleanupAsync(f, guestId); }
    }

    [SkippableFact]
    public async Task Guest_Stems_Stage_Lock_Unavailable_Fails_Closed_503()
    {
        await TestDb.RequireAsync(factory);
        using var f = Build(distLock: new ThrowingDistributedLock());
        var (client, demo) = await StartGuestAsync(f);
        var guestId = demo.User.Id;
        try
        {
            var versionId = await SeedEmptyVersionAsync(f, guestId);
            var resp = await client.PostAsync($"/api/versions/{versionId}/stems/stage", OneStem("lockfail.wav"));
            Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
            Assert.Equal("demo_capacity", await Code(resp));
        }
        finally { await CleanupAsync(f, guestId); }
    }

    // Task G7a (R3a) — the lock is already HELD (not unavailable): the
    // handler answers 429 guest_busy, stages nothing, and — proven by
    // HeldDistributedLock.ReleaseAsync throwing — never calls release with a
    // token it never acquired.
    [SkippableFact]
    public async Task Guest_Stems_Stage_Lock_Already_Held_Answers_429_And_Stages_Nothing()
    {
        await TestDb.RequireAsync(factory);
        using var f = Build(distLock: new HeldDistributedLock());
        var (client, demo) = await StartGuestAsync(f);
        var guestId = demo.User.Id;
        try
        {
            var versionId = await SeedEmptyVersionAsync(f, guestId);
            var resp = await client.PostAsync($"/api/versions/{versionId}/stems/stage", OneStem("busy.wav"));
            Assert.Equal(HttpStatusCode.TooManyRequests, resp.StatusCode);
            Assert.Equal("guest_busy", await Code(resp));

            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var raw = await db.SongVersions.AsNoTracking()
                .Where(v => v.Id == versionId).Select(v => v.StemPathsRaw).FirstOrDefaultAsync();
            Assert.Empty(Spectr.Bff.Endpoints.VersionEndpoints.ReadRaw(raw));
        }
        finally { await CleanupAsync(f, guestId); }
    }

    // Task G7a (R2) — fires a "concurrent append" (a second request finishing
    // its own stage call) right AFTER the OwnedVersion JOIN query (the one
    // that materializes the tracked `version` StageStems mutates) has
    // ALREADY executed — so `version.StemPathsRaw` is captured stale, and
    // the concurrent write lands in the DB only afterward, standing in for
    // a real request that outlives the 120s lock TTL while this one is
    // still reading its (possibly slow) body. Matched by shape (a JOIN
    // touching song_versions) rather than the EARLIER narrow
    // content-length-precheck SELECT, which would otherwise already see
    // the concurrent write and defeat the point of this test. Only armed
    // once the test's own seeding is done (never during /api/auth/demo or
    // the seed itself), and only fires once, via ReaderExecutedAsync (AFTER
    // the query already ran) rather than ReaderExecutingAsync (before).
    private sealed class ConcurrentAppendInterceptor(Guid versionId, string concurrentStemPathsRawJson)
        : DbCommandInterceptor
    {
        public IServiceProvider? RootProvider { get; set; }
        public bool Armed { get; set; }
        private bool _done;

        public override async ValueTask<DbDataReader> ReaderExecutedAsync(
            DbCommand command, CommandExecutedEventData eventData, DbDataReader result,
            CancellationToken cancellationToken = default)
        {
            if (Armed && !_done
                && command.CommandText.Contains("JOIN", StringComparison.OrdinalIgnoreCase)
                && command.CommandText.Contains("song_versions", StringComparison.OrdinalIgnoreCase))
            {
                _done = true;
                using var scope = RootProvider!.CreateScope();
                var db2 = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var v2 = await db2.SongVersions.SingleAsync(x => x.Id == versionId, cancellationToken);
                v2.StemPathsRaw = concurrentStemPathsRawJson;
                await db2.SaveChangesAsync(cancellationToken);
            }
            return result;
        }
    }

    // guest_stems_max_files defaults to 12. Seeded at 11; the "concurrent"
    // request's append brings the row to 12 (still under cap); THIS
    // request's own +1 file would make 13 (over cap). A correct handler
    // rejects this request AND keeps the concurrent entry; the pre-fix
    // handler (stale in-memory `entries` from before the body read) would
    // instead accept this request and silently overwrite the row with its
    // own stale 11+1=12 — losing the concurrent entry without ever
    // exceeding the numeric cap, which is exactly why this needed its own
    // deterministic test rather than trusting the parallel-HTTP race test.
    [SkippableFact]
    public async Task Concurrent_Append_During_The_Body_Read_Is_Never_Lost_And_The_Cap_Still_Holds()
    {
        await TestDb.RequireAsync(factory);

        var existing = Enumerable.Range(0, 11)
            .Select(i => new { id = $"pre-{i}", original_filename = $"pre-{i}.wav", path = $"audio/stems/fake/pre-{i}.wav" })
            .ToList();
        var concurrent = existing.Append(new { id = "concurrent", original_filename = "concurrent.wav", path = "audio/stems/fake/concurrent.wav" }).ToList();
        var existingJson = JsonSerializer.Serialize(existing);
        var concurrentJson = JsonSerializer.Serialize(concurrent);

        var versionId = Guid.NewGuid();
        var songId = Guid.NewGuid();
        var interceptor = new ConcurrentAppendInterceptor(versionId, concurrentJson);
        var f = factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Demo:Enabled", "true");
            b.UseSetting("Demo:SnapshotKey", "");
            // A plain DI-registered IInterceptor is NOT auto-picked-up by
            // AddDbContext — re-register AppDbContext itself (last
            // registration wins) with the SAME connection string plus this
            // interceptor wired in via AddInterceptors.
            b.ConfigureServices((ctx, s) =>
            {
                var conn = ctx.Configuration.GetConnectionString("Postgres");
                s.AddDbContext<AppDbContext>(o => o.UseNpgsql(conn).AddInterceptors(interceptor));
            });
        });
        interceptor.RootProvider = f.Services;

        var (client, demo) = await StartGuestAsync(f);
        var guestId = demo.User.Id;
        try
        {
            using (var scope = f.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.Songs.Add(new Song { Id = songId, UserId = guestId, Name = "Race test" });
                db.SongVersions.Add(new SongVersion
                {
                    Id = versionId, SongId = songId, FilePath = "audio/bytecap/race.wav", VersionNumber = 1,
                    StemPathsRaw = existingJson,
                });
                await db.SaveChangesAsync();
            }

            interceptor.Armed = true;
            var resp = await client.PostAsync($"/api/versions/{versionId}/stems/stage", OneStem("mine.wav"));
            Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
            Assert.Equal("stems_limit", await Reason(resp));

            using var scope2 = f.Services.CreateScope();
            var db2 = scope2.ServiceProvider.GetRequiredService<AppDbContext>();
            var raw = await db2.SongVersions.AsNoTracking()
                .Where(v => v.Id == versionId).Select(v => v.StemPathsRaw).FirstOrDefaultAsync();
            var final = Spectr.Bff.Endpoints.VersionEndpoints.ReadRaw(raw);
            Assert.Equal(12, final.Count); // 11 pre-existing + the concurrent append — NOTHING lost
            Assert.Contains(final, e => e.Id == "concurrent");
            Assert.DoesNotContain(final, e => e.OriginalFilename == "mine.wav"); // correctly rejected, not silently accepted
        }
        finally { await CleanupAsync(f, guestId); }
    }
}
