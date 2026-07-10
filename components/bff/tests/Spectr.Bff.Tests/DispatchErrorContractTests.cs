using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Net;
using System.Text.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 12.1 (AC5) — the dispatch-path error CONTRACT: every rejection must
// carry the AR38 envelope `{ error: { code, message } }` with a stable
// machine-readable code. The frontend keys off `code`, never message text —
// these tests pin the codes so a rename is a loud break, not a silent
// frontend regression.
public sealed class DispatchErrorContractTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private static async Task AssertEnvelopeAsync(
        HttpResponseMessage resp, HttpStatusCode expectedStatus, string expectedCode)
    {
        Assert.Equal(expectedStatus, resp.StatusCode);
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        var error = doc.RootElement.GetProperty("error");
        Assert.Equal(expectedCode, error.GetProperty("code").GetString());
        Assert.False(string.IsNullOrWhiteSpace(error.GetProperty("message").GetString()));
    }

    private async Task<(Guid UserId, HttpClient Client)> RegisterVerifiedAsync()
    {
        var client = _factory.CreateClient();
        var (userId, token) = await TestAuth.RegisterAsync(client);
        client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        return (userId, client);
    }

    private async Task CleanupAsync(Guid userId, Guid songId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await TestAuth.AllowPurgeAsync(db);
        await db.AnalysisJobs.Where(j => j.UserId == userId).ExecuteDeleteAsync();
        await db.UsageEvents.Where(e => e.UserId == userId).ExecuteDeleteAsync();
        await db.CreditLedger.Where(e => e.UserId == userId).ExecuteDeleteAsync();
        await db.SongVersions.Where(v => v.SongId == songId).ExecuteDeleteAsync();
        await db.Songs.Where(s => s.Id == songId).ExecuteDeleteAsync();
        await db.RefreshTokens.Where(t => t.UserId == userId).ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
    }

    [Fact]
    public async Task Verify_Gate_403_Carries_Machine_Code()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (userId, client) = await RegisterVerifiedAsync();
        var (songId, versionId) = await TestSeed.SongWithVersionAsync(_factory, userId);
        try
        {
            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.AnalysisJobs.Add(new AnalysisJob
                { Id = Guid.NewGuid(), UserId = userId, VersionId = versionId, Status = "complete" });
                await db.SaveChangesAsync();
                // Strip the story-12.1 dev auto-verify stamp — this test IS
                // the unverified path.
                await db.Users.Where(u => u.Id == userId).ExecuteUpdateAsync(
                    s => s.SetProperty(u => u.EmailVerifiedAt, (DateTimeOffset?)null));
            }

            var resp = await client.PostAsync($"/api/versions/{versionId}/analyze", null);
            await AssertEnvelopeAsync(resp, HttpStatusCode.Forbidden, "email_verification_required");
        }
        finally
        {
            await CleanupAsync(userId, songId);
        }
    }

    [Fact]
    public async Task Free_Cap_Exhaustion_409_Carries_Machine_Code()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (userId, client) = await RegisterVerifiedAsync();
        var (songId, versionId) = await TestSeed.SongWithVersionAsync(_factory, userId);
        try
        {
            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var ents = scope.ServiceProvider.GetRequiredService<EntitlementService>();
                // Auto-verify may be off in some configs — verified is a
                // precondition here (we want the CAP arm, not the gate).
                await db.Users.Where(u => u.Id == userId).ExecuteUpdateAsync(
                    s => s.SetProperty(u => u.EmailVerifiedAt, DateTimeOffset.UtcNow));
                // Burn the whole free cap (flag-driven; default 3).
                var flags = await ents.GetFlagsAsync(CancellationToken.None);
                var cap = flags.TryGetValue("free_analyses_per_month", out var v)
                    && int.TryParse(v, out var n) && n > 0 ? n : 3;
                var period = DateTimeOffset.UtcNow.ToString("yyyy-MM");
                for (var i = 0; i < cap; i++)
                    db.UsageEvents.Add(new UsageEvent
                    {
                        UserId = userId,
                        EventType = "analysis",
                        BillingPeriod = period,
                        OccurredAt = DateTimeOffset.UtcNow,
                    });
                await db.SaveChangesAsync();
            }

            var resp = await client.PostAsync($"/api/versions/{versionId}/analyze", null);
            await AssertEnvelopeAsync(resp, HttpStatusCode.Conflict, "entitlement_exhausted");
        }
        finally
        {
            await CleanupAsync(userId, songId);
        }
    }

    [Fact]
    public async Task Insufficient_Credits_Race_409_Carries_Machine_Code()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        var (userId, client) = await RegisterVerifiedAsync();
        var (songId, versionId) = await TestSeed.SongWithVersionAsync(_factory, userId);
        try
        {
            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                await db.Users.Where(u => u.Id == userId).ExecuteUpdateAsync(
                    s => s.SetProperty(u => u.EmailVerifiedAt, DateTimeOffset.UtcNow));
                // Balance 1 → credits tier at entitlement-check time.
                db.CreditLedger.Add(new CreditLedgerEntry
                { UserId = userId, Amount = 1, Reason = "purchase", Reference = $"test:{Guid.NewGuid():N}" });
                await db.SaveChangesAsync();
                // Warm the 60 s entitlement cache with the credits/1 snapshot…
                _ = await scope.ServiceProvider.GetRequiredService<EntitlementService>()
                    .ForAsync(userId, CancellationToken.None);
                // …then drain the balance behind the cache's back. Dispatch
                // now reproduces the story-2.3 race deterministically: the
                // cached check passes, the serializable spend refuses.
                db.CreditLedger.Add(new CreditLedgerEntry
                { UserId = userId, Amount = -1, Reason = "adjustment", Reference = $"test:{Guid.NewGuid():N}" });
                await db.SaveChangesAsync();
            }

            var resp = await client.PostAsync($"/api/versions/{versionId}/analyze", null);
            await AssertEnvelopeAsync(resp, HttpStatusCode.Conflict, "insufficient_credits");
        }
        finally
        {
            await CleanupAsync(userId, songId);
        }
    }

    private sealed class ThrowingEntitlementService(
        AppDbContext db, IMemoryCache cache, ILogger<EntitlementService> logger)
        : EntitlementService(db, cache, logger)
    {
        public override Task<EntitlementsDto> ForAsync(Guid userId, CancellationToken ct)
            => throw new InvalidOperationException("entitlements backend down (test)");
    }

    [Fact]
    public async Task Entitlements_Unavailable_503_Carries_Machine_Code()
    {
        if (!await TestDb.Reachable(_factory)) { return; }

        // Register on the healthy factory; dispatch through one whose
        // entitlement resolver throws.
        var (userId, token) = await TestAuth.RegisterAsync(_factory.CreateClient());
        var (songId, versionId) = await TestSeed.SongWithVersionAsync(_factory, userId);
        using var broken = _factory.WithWebHostBuilder(b =>
            b.ConfigureServices(s =>
            {
                s.RemoveAll<EntitlementService>();
                s.AddScoped<EntitlementService, ThrowingEntitlementService>();
            }));
        var client = broken.CreateClient();
        client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        try
        {
            var resp = await client.PostAsync($"/api/versions/{versionId}/analyze", null);
            await AssertEnvelopeAsync(resp, HttpStatusCode.ServiceUnavailable, "entitlements_unavailable");
        }
        finally
        {
            await CleanupAsync(userId, songId);
        }
    }
}
