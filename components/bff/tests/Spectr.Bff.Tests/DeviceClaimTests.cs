using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Net;
using System.Net.Http.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 4.5 — device identity + claim + XOR ownership + verify gate.
public sealed class DeviceClaimTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    // ── UlidGen + cookie primitives (pure) ──────────────────────────────────

    [Fact]
    public void Ulid_Is_26_Crockford_Chars_And_Time_Prefixed()
    {
        var a = UlidGen.NewUlid();
        var b = UlidGen.NewUlid();
        Assert.Equal(26, a.Length);
        Assert.All(a, c => Assert.Contains(c, "0123456789ABCDEFGHJKMNPQRSTVWXYZ"));
        Assert.NotEqual(a, b);                       // randomness
        // Same millisecond-ish: timestamp prefix (first ~8 chars) sorts with time.
        Assert.True(string.CompareOrdinal(a[..6], b[..6]) <= 0);
    }

    [Fact]
    public void Device_Cookie_Signs_And_Verifies_Constant_Time()
    {
        const string key = "unit-test-signing-key-0123456789";
        var id = UlidGen.NewUlid();
        var cookie = DeviceService.Sign(id, key);

        Assert.Equal(id, DeviceService.Verify(cookie, key));
        Assert.Null(DeviceService.Verify(cookie, key + "x"));      // wrong key
        Assert.Null(DeviceService.Verify($"{id}.DEADBEEF", key));  // bad sig
        Assert.Null(DeviceService.Verify(id, key));                // no sig
        Assert.Null(DeviceService.Verify(DeviceService.Sign("short", key), key)); // bad id shape
    }

    // ── XOR CHECK (AC2) ─────────────────────────────────────────────────────

    [Fact]
    public async Task Ownership_Check_Rejects_Both_And_Neither()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        // Neither owner → CHECK violation.
        db.AnalysisJobs.Add(new AnalysisJob { Id = Guid.NewGuid(), UserId = null, DeviceId = null });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();

        // Both owners → CHECK violation.
        var device = new Device { Id = UlidGen.NewUlid(), IpHash = "x", UaHash = "y" };
        db.Devices.Add(device);
        await db.SaveChangesAsync();
        try
        {
            db.AnalysisJobs.Add(new AnalysisJob
            { Id = Guid.NewGuid(), UserId = Guid.NewGuid(), DeviceId = device.Id });
            await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
            db.ChangeTracker.Clear();
        }
        finally
        {
            await db.Devices.Where(d => d.Id == device.Id).ExecuteDeleteAsync();
        }
    }

    // ── Claim (AC3) ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Register_With_Device_Cookie_Claims_All_Rows_In_One_Shot()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        using var scope0 = _factory.Services.CreateScope();
        var seedDb = scope0.ServiceProvider.GetRequiredService<AppDbContext>();
        var cfg = scope0.ServiceProvider.GetRequiredService<IConfiguration>();
        var signingKey = cfg["Anon:SigningKey"]!;

        var device = new Device { Id = UlidGen.NewUlid(), IpHash = "x", UaHash = "y" };
        var jobId = Guid.NewGuid();
        var analysisId = Guid.NewGuid();
        var convId = Guid.NewGuid();
        seedDb.Devices.Add(device);
        seedDb.AnalysisJobs.Add(new AnalysisJob
        { Id = jobId, DeviceId = device.Id, Status = "complete" });
        seedDb.Analyses.Add(new Analysis
        { Id = analysisId, JobId = jobId, DeviceId = device.Id, FinalJson = "{}" });
        seedDb.Conversations.Add(new Conversation
        { Id = convId, AnalysisId = analysisId, DeviceId = device.Id });
        await seedDb.SaveChangesAsync();

        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        var address = $"claim+{Guid.NewGuid():N}@spectr.test";
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/auth/register")
        {
            Content = JsonContent.Create(new { email = address, password = "CorrectHorse9!" }),
        };
        req.Headers.Add("Cookie",
            $"{DeviceService.CookieName}={DeviceService.Sign(device.Id, signingKey)}");

        Guid userId;
        try
        {
            var resp = await client.SendAsync(req);
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            var body = await resp.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
            userId = body.GetProperty("user").GetProperty("id").GetGuid();

            // Cookie CLEARED (empty value) — a re-issued 30-day cookie would
            // also carry expires=, so assert the deletion shape specifically.
            Assert.Contains(resp.Headers.GetValues("Set-Cookie"),
                c => c.StartsWith($"{DeviceService.CookieName}=;")
                  || c.StartsWith($"{DeviceService.CookieName}=; "));

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var job = await db.AnalysisJobs.AsNoTracking().SingleAsync(j => j.Id == jobId);
            var analysis = await db.Analyses.AsNoTracking().SingleAsync(a => a.Id == analysisId);
            var conv = await db.Conversations.AsNoTracking().SingleAsync(c => c.Id == convId);
            Assert.Equal(userId, job.UserId);
            Assert.Null(job.DeviceId);
            Assert.Equal(userId, analysis.UserId);
            Assert.Null(analysis.DeviceId);
            Assert.Equal(userId, conv.UserId);
            Assert.Null(conv.DeviceId);

            var claimed = await db.Devices.AsNoTracking().SingleAsync(d => d.Id == device.Id);
            Assert.NotNull(claimed.ClaimedAt);
            Assert.Equal(userId, claimed.ClaimedByUserId);

            // Second registration with the SAME cookie: device already
            // claimed — plain registration, rows untouched.
            var req2 = new HttpRequestMessage(HttpMethod.Post, "/api/auth/register")
            {
                Content = JsonContent.Create(new
                { email = $"claim2+{Guid.NewGuid():N}@spectr.test", password = "CorrectHorse9!" }),
            };
            req2.Headers.Add("Cookie",
                $"{DeviceService.CookieName}={DeviceService.Sign(device.Id, signingKey)}");
            var resp2 = await client.SendAsync(req2);
            Assert.Equal(HttpStatusCode.OK, resp2.StatusCode);
            var jobAfter = await db.AnalysisJobs.AsNoTracking().SingleAsync(j => j.Id == jobId);
            Assert.Equal(userId, jobAfter.UserId); // still the FIRST user's
        }
        finally
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Conversations.Where(c => c.Id == convId).ExecuteDeleteAsync();
            await db.Analyses.Where(a => a.Id == analysisId).ExecuteDeleteAsync();
            await db.AnalysisJobs.Where(j => j.Id == jobId).ExecuteDeleteAsync();
            await db.Devices.Where(d => d.Id == device.Id).ExecuteDeleteAsync();
        }
    }

    // ── GetOrCreate branches (AC1 service-level) ───────────────────────────

    [Fact]
    public async Task GetOrCreate_Reuses_Valid_Unclaimed_And_Mints_Fresh_For_Claimed_Or_Purged()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        using var scope = _factory.Services.CreateScope();
        var svc = scope.ServiceProvider.GetRequiredService<DeviceService>();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var cfg = scope.ServiceProvider.GetRequiredService<IConfiguration>();
        var key = cfg["Anon:SigningKey"]!;

        Microsoft.AspNetCore.Http.DefaultHttpContext Ctx(string? cookie)
        {
            var ctx = new Microsoft.AspNetCore.Http.DefaultHttpContext();
            if (cookie is not null)
                ctx.Request.Headers.Cookie = $"{DeviceService.CookieName}={cookie}";
            return ctx;
        }

        var created = new List<string>();
        try
        {
            // No cookie → fresh row + Set-Cookie.
            var ctx1 = Ctx(null);
            var d1 = await svc.GetOrCreateAsync(ctx1);
            created.Add(d1.Id);
            Assert.Contains("spectr_device=", ctx1.Response.Headers.SetCookie.ToString());

            // Valid unclaimed cookie → SAME row, no new cookie needed.
            var ctx2 = Ctx(DeviceService.Sign(d1.Id, key));
            var d2 = await svc.GetOrCreateAsync(ctx2);
            Assert.Equal(d1.Id, d2.Id);

            // Claimed device cookie → FRESH identity (claimed rows must not
            // re-accumulate anonymous children).
            await db.Devices.Where(d => d.Id == d1.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(d => d.ClaimedAt, DateTimeOffset.UtcNow));
            db.ChangeTracker.Clear(); // ExecuteUpdate bypasses the tracker
            var ctx3 = Ctx(DeviceService.Sign(d1.Id, key));
            var d3 = await svc.GetOrCreateAsync(ctx3);
            created.Add(d3.Id);
            Assert.NotEqual(d1.Id, d3.Id);

            // Cookie for a PURGED (deleted) row → fresh identity too.
            await db.Devices.Where(d => d.Id == d3.Id).ExecuteDeleteAsync();
            var ctx4 = Ctx(DeviceService.Sign(d3.Id, key));
            var d4 = await svc.GetOrCreateAsync(ctx4);
            created.Add(d4.Id);
            Assert.NotEqual(d3.Id, d4.Id);
        }
        finally
        {
            await db.Devices.Where(d => created.Contains(d.Id)).ExecuteDeleteAsync();
        }
    }

    // ── Verify gate (AC5) ───────────────────────────────────────────────────

    [Fact]
    public async Task Second_Analysis_Requires_Verification_For_Free_Tier()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        var (_, versionId) = await TestSeed.SongWithVersionAsync(_factory, userId);

        try
        {
            // Simulate one prior analysis job (the free first one).
            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.AnalysisJobs.Add(new AnalysisJob
                { Id = Guid.NewGuid(), UserId = userId, VersionId = versionId, Status = "complete" });
                await db.SaveChangesAsync();
            }

            // Unverified + prior job → 403 with the envelope.
            var denied = await client.PostAsync($"/api/versions/{versionId}/analyze", null);
            Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
            Assert.Contains("email_verification_required", await denied.Content.ReadAsStringAsync());

            // Verify the email → dispatch allowed.
            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                await db.Users.Where(u => u.Id == userId)
                    .ExecuteUpdateAsync(s => s.SetProperty(u => u.EmailVerifiedAt, DateTimeOffset.UtcNow));
            }
            var allowed = await client.PostAsync($"/api/versions/{versionId}/analyze", null);
            Assert.NotEqual(HttpStatusCode.Forbidden, allowed.StatusCode);
        }
        finally
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.AnalysisJobs.Where(j => j.UserId == userId).ExecuteDeleteAsync();
        }
    }
}
