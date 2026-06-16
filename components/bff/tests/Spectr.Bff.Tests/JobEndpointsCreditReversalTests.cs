using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Xunit;
using UserEntity = Spectr.Data.Entities.User;

namespace Spectr.Bff.Tests;

// Story 2.3 / AC3 — lazy credit reversal on GET /api/jobs/{id} when
// the worker writes a typed `invalid_file` failure on a credit-funded
// job. Partial unique index on `reversal:<jobId>` makes the read-path
// hook idempotent against duplicate reads.

public sealed class JobEndpointsCreditReversalTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private async Task<bool> PostgresReachable()
    {
        try
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.Database.CanConnectAsync();
        }
        catch { return false; }
    }

    private static async Task<(HttpClient C, Guid UserId)> SeedAuthedAsync(
        WebApplicationFactory<Program> factory, string prefix)
    {
        var client = factory.CreateClient();
        var email = $"{prefix}+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync(
            "/api/auth/register", new { email, password = "correct-horse-battery" });
        var auth = await reg.Content.ReadFromJsonAsync<AuthResponse>();
        Assert.NotNull(auth);
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", auth!.AccessToken);
        return (client, auth.User.Id);
    }

    private async Task<Guid> SeedFailedInvalidFileJobAsync(
        Guid userId, bool withSpend)
    {
        var jobId = Guid.NewGuid();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.AnalysisJobs.Add(new AnalysisJob
        {
            Id = jobId,
            UserId = userId,
            Status = "failed",
            CurrentPhase = "validation",
            PhasePct = 0,
            ErrorMessage = "Unsupported audio format",
            ErrorCode = "invalid_file",
            FailedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();

        if (withSpend)
        {
            var svc = scope.ServiceProvider.GetRequiredService<CreditLedgerService>();
            await svc.PurchaseAsync(userId, 5, "pi_jobrev_seed",
                $"credits_purchase:seed_{jobId:N}", CancellationToken.None);
            await svc.SpendAsync(userId, jobId, "2026-06", CancellationToken.None);
        }
        return jobId;
    }

    private async Task CleanupAsync(Guid userId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.CreditLedger.Where(e => e.UserId == userId).ExecuteDeleteAsync();
        await db.UsageEvents.Where(e => e.UserId == userId).ExecuteDeleteAsync();
        await db.AnalysisJobs.Where(j => j.UserId == userId).ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
    }

    [Fact]
    public async Task GetJob_With_InvalidFile_And_Prior_Spend_Refunds_Credit()
    {
        if (!await PostgresReachable()) { return; }
        var (client, userId) = await SeedAuthedAsync(_factory, "jobrev-refund");
        try
        {
            var jobId = await SeedFailedInvalidFileJobAsync(userId, withSpend: true);

            var resp = await client.GetAsync($"/api/jobs/{jobId}");
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var reversal = await db.CreditLedger
                .Where(e => e.UserId == userId && e.Reason == "reversal")
                .FirstAsync();
            Assert.Equal(1, reversal.Amount);
            Assert.Equal($"reversal:{jobId}", reversal.IdempotencyKey);

            // Balance: +5 purchase, -1 spend, +1 reversal = 5.
            var svc = scope.ServiceProvider.GetRequiredService<CreditLedgerService>();
            Assert.Equal(5, await svc.GetBalanceAsync(userId, CancellationToken.None));
        }
        finally { await CleanupAsync(userId); }
    }

    [Fact]
    public async Task GetJob_Second_Read_Does_Not_Double_Refund()
    {
        if (!await PostgresReachable()) { return; }
        var (client, userId) = await SeedAuthedAsync(_factory, "jobrev-dup");
        try
        {
            var jobId = await SeedFailedInvalidFileJobAsync(userId, withSpend: true);

            await client.GetAsync($"/api/jobs/{jobId}");
            await client.GetAsync($"/api/jobs/{jobId}");
            await client.GetAsync($"/api/jobs/{jobId}");

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var reversalCount = await db.CreditLedger
                .CountAsync(e => e.UserId == userId && e.Reason == "reversal");
            Assert.Equal(1, reversalCount);
        }
        finally { await CleanupAsync(userId); }
    }

    [Fact]
    public async Task GetJob_Without_Prior_Spend_Does_Not_Refund()
    {
        // A failed-invalid-file job on a subscription-funded user
        // (no credit spend recorded) MUST NOT cause a spurious +1
        // credit row to appear.
        if (!await PostgresReachable()) { return; }
        var (client, userId) = await SeedAuthedAsync(_factory, "jobrev-nospend");
        try
        {
            var jobId = await SeedFailedInvalidFileJobAsync(userId, withSpend: false);

            var resp = await client.GetAsync($"/api/jobs/{jobId}");
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var count = await db.CreditLedger.CountAsync(e => e.UserId == userId);
            Assert.Equal(0, count);
        }
        finally { await CleanupAsync(userId); }
    }
}
