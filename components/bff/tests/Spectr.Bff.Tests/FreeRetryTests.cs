using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Spectr.Data.Entities;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 5.7 (FR6/AR16) — POST /api/jobs/{jobId}/retry: the free retry.
// Eligibility is 100% server-derived; the dispatch consumes NO entitlement
// (no usage_events row, no credit_ledger spend) and works even when the
// user's cap is exhausted. One free retry per origin; retry-of-retry capped.
public sealed class FreeRetryTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private const string DegradedFinalJson =
        """{"phases":[{"phase":1,"status":"ok"},{"phase":4,"status":"failed","error":"stem clash exploded"},{"phase":5,"status":"ok"}]}""";
    private const string CleanFinalJson =
        """{"phases":[{"phase":1,"status":"ok"},{"phase":4,"status":"ok"}]}""";

    private (HttpClient client, RecordingJobQueue queue) NewClient()
    {
        var queue = new RecordingJobQueue();
        var client = _factory.WithWebHostBuilder(b =>
        {
            b.ConfigureServices(s =>
            {
                s.RemoveAll<IJobQueue>();
                s.AddSingleton<IJobQueue>(queue);
            });
        }).CreateClient();
        return (client, queue);
    }

    private static async Task<(HttpClient Client, Guid UserId)> AuthAsync(
        HttpClient client, string prefix)
    {
        var email = $"{prefix}+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync("/api/auth/register",
            new { email, password = "correct-horse-battery" });
        reg.EnsureSuccessStatusCode();
        var auth = await reg.Content.ReadFromJsonAsync<AuthResponse>();
        Assert.NotNull(auth);
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", auth!.AccessToken);
        return (client, auth.User.Id);
    }

    private static async Task<Guid> CreateVersionAsync(HttpClient client)
    {
        using var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(new byte[1024]);
        file.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        form.Add(file, "file", "retry-test.wav");
        form.Add(new StringContent("false"), "analyze");
        var resp = await client.PostAsync("/api/versions/", form);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<UploadResponse>();
        return body!.VersionId;
    }

    // Seed an origin job (+ optional analyses row) directly — the retry
    // endpoint's eligibility reads exactly these rows. `consumed` (default)
    // writes the usage event a real dispatch would have written; only
    // consuming origins are free-retry eligible (rerun-phase guard).
    private async Task<Guid> SeedOriginAsync(
        Guid userId, Guid? versionId, string status,
        string? errorCode = null, string? finalJson = null,
        Guid? retryOfJobId = null, bool consumed = true,
        string? deviceId = null)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var jobId = Guid.NewGuid();
        db.AnalysisJobs.Add(new AnalysisJob
        {
            Id = jobId,
            UserId = deviceId is null ? userId : null,
            DeviceId = deviceId,
            VersionId = versionId,
            Status = status,
            ErrorCode = errorCode,
            Tier = "free",
            RetryOfJobId = retryOfJobId,
            FailedAt = status == "failed" ? DateTimeOffset.UtcNow : null,
            CompletedAt = status == "complete" ? DateTimeOffset.UtcNow : null,
        });
        if (consumed && deviceId is null)
        {
            db.UsageEvents.Add(new UsageEvent
            {
                UserId = userId,
                EventType = "analysis",
                BillingPeriod = DateTimeOffset.UtcNow.ToString("yyyy-MM"),
                Reference = jobId.ToString(),
            });
        }
        if (finalJson is not null)
        {
            db.Analyses.Add(new Analysis
            {
                JobId = jobId,
                UserId = deviceId is null ? userId : null,
                DeviceId = deviceId,
                VersionId = versionId,
                FinalJson = finalJson,
            });
        }
        await db.SaveChangesAsync();
        return jobId;
    }

    private async Task SeedUsageAsync(Guid userId, int count)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var period = DateTimeOffset.UtcNow.ToString("yyyy-MM");
        for (var i = 0; i < count; i++)
        {
            db.UsageEvents.Add(new UsageEvent
            {
                UserId = userId,
                EventType = "analysis",
                BillingPeriod = period,
                Reference = Guid.NewGuid().ToString(),
            });
        }
        await db.SaveChangesAsync();
    }

    private async Task SeedCreditAsync(Guid userId, int balance)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.CreditLedger.Add(new CreditLedgerEntry
        {
            UserId = userId,
            Amount = balance,
            Reason = "purchase",
            Reference = "pi_retry_test",
            IdempotencyKey = $"credits_purchase:retry_{Guid.NewGuid():N}",
        });
        await db.SaveChangesAsync();
    }

    private async Task<(int usage, int spends, AnalysisJob? retryJob)> SnapshotAsync(
        Guid userId, Guid originJobId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var period = DateTimeOffset.UtcNow.ToString("yyyy-MM");
        var usage = await db.UsageEvents.CountAsync(
            e => e.UserId == userId && e.EventType == "analysis" && e.BillingPeriod == period);
        var spends = await db.CreditLedger.CountAsync(
            e => e.UserId == userId && e.Reason == "spend");
        var retryJob = await db.AnalysisJobs.AsNoTracking()
            .FirstOrDefaultAsync(j => j.RetryOfJobId == originJobId);
        return (usage, spends, retryJob);
    }

    // ── Degraded-complete origin + EXHAUSTED cap → retry still free ─────────
    // The whole story: a free user whose 3rd analysis partially failed gets
    // the re-run even though AnalysesRemaining == 0, and nothing is metered.
    [SkippableFact]
    public async Task DegradedOrigin_ExhaustedCap_RetryDispatchesFree()
    {
        await TestDb.RequireAsync(_factory);
        var (client, queue) = NewClient();
        var (_, userId) = await AuthAsync(client, "retry-a");
        var versionId = await CreateVersionAsync(client);
        await SeedUsageAsync(userId, 2); // + the origin's own event = cap of 3 consumed
        var origin = await SeedOriginAsync(
            userId, versionId, "complete", finalJson: DegradedFinalJson);

        var resp = await client.PostAsync($"/api/jobs/{origin}/retry", null);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<RetryResponseBody>();
        Assert.NotNull(body);
        Assert.NotEqual(Guid.Empty, body!.JobId);
        Assert.Single(queue.Calls);
        Assert.Equal(DramatiqTasks.AnalyzeAudioJob, queue.Calls.First());

        var (usage, spends, retryJob) = await SnapshotAsync(userId, origin);
        Assert.Equal(3, usage);   // unchanged — nothing consumed
        Assert.Equal(0, spends);  // no credit spend either
        Assert.NotNull(retryJob);
        Assert.Equal(body.JobId, retryJob!.Id);
        Assert.Equal(versionId, retryJob.VersionId); // same song version (AC2)
        Assert.Equal("pending", retryJob.Status);
    }

    // ── Failed origin (≠ invalid_file) is eligible ──────────────────────────
    [SkippableFact]
    public async Task FailedOrigin_NonInvalidFile_Eligible()
    {
        await TestDb.RequireAsync(_factory);
        var (client, queue) = NewClient();
        var (_, userId) = await AuthAsync(client, "retry-b");
        var versionId = await CreateVersionAsync(client);
        var origin = await SeedOriginAsync(
            userId, versionId, "failed", errorCode: "dispatch_failed");

        var resp = await client.PostAsync($"/api/jobs/{origin}/retry", null);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        Assert.Single(queue.Calls);

        var (usage, spends, retryJob) = await SnapshotAsync(userId, origin);
        Assert.Equal(1, usage); // the origin's own event only — retry added none
        Assert.Equal(0, spends);
        Assert.NotNull(retryJob);
    }

    // ── Credit-tier user: retry consumes no credit, balance intact ──────────
    [SkippableFact]
    public async Task CreditsOrigin_RetryKeepsBalance()
    {
        await TestDb.RequireAsync(_factory);
        var (client, queue) = NewClient();
        var (_, userId) = await AuthAsync(client, "retry-j");
        var versionId = await CreateVersionAsync(client);
        await SeedCreditAsync(userId, 1);
        var origin = await SeedOriginAsync(
            userId, versionId, "complete", finalJson: DegradedFinalJson);

        var resp = await client.PostAsync($"/api/jobs/{origin}/retry", null);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        Assert.Single(queue.Calls);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var balance = await db.CreditLedger
            .Where(e => e.UserId == userId)
            .SumAsync(e => (int?)e.Amount) ?? 0;
        Assert.Equal(1, balance); // purchase intact — no spend row from the retry
        var spendRows = await db.CreditLedger
            .CountAsync(e => e.UserId == userId && e.Reason == "spend");
        Assert.Equal(0, spendRows);
    }

    // ── Device-owned (anon) origin → 404 (authed-only surface) ──────────────
    [SkippableFact]
    public async Task DeviceOwnedOrigin_404()
    {
        await TestDb.RequireAsync(_factory);
        var (client, queue) = NewClient();
        var (_, userId) = await AuthAsync(client, "retry-k");
        var origin = await SeedOriginAsync(
            userId, versionId: null, "failed", errorCode: "worker_unavailable",
            deviceId: "01ARZ3NDEKTSV4RRFFQ69G5FAV");

        var resp = await client.PostAsync($"/api/jobs/{origin}/retry", null);
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        Assert.Empty(queue.Calls);
    }

    // ── Non-consuming origin (rerun-phase tracking job shape) → 409 ─────────
    // A job with user+version but NO usage event / credit spend must not mint
    // a free full analysis (review finding: rerun_phase jobs are dispatchable
    // repeatedly and consume nothing).
    [SkippableFact]
    public async Task NonConsumingOrigin_409NotEligible()
    {
        await TestDb.RequireAsync(_factory);
        var (client, queue) = NewClient();
        var (_, userId) = await AuthAsync(client, "retry-l");
        var versionId = await CreateVersionAsync(client);
        var origin = await SeedOriginAsync(
            userId, versionId, "failed", errorCode: null, consumed: false);

        var resp = await client.PostAsync($"/api/jobs/{origin}/retry", null);
        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<ErrorEnvelopeBody>();
        Assert.Equal("retry_not_eligible", body?.Error?.Code);
        Assert.Empty(queue.Calls);
    }

    // ── Second retry of the same origin → 409 retry_already_used ────────────
    [SkippableFact]
    public async Task SecondRetry_409AlreadyUsed()
    {
        await TestDb.RequireAsync(_factory);
        var (client, queue) = NewClient();
        var (_, userId) = await AuthAsync(client, "retry-c");
        var versionId = await CreateVersionAsync(client);
        var origin = await SeedOriginAsync(
            userId, versionId, "complete", finalJson: DegradedFinalJson);

        var first = await client.PostAsync($"/api/jobs/{origin}/retry", null);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);

        var second = await client.PostAsync($"/api/jobs/{origin}/retry", null);
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
        var body = await second.Content.ReadFromJsonAsync<ErrorEnvelopeBody>();
        Assert.Equal("retry_already_used", body?.Error?.Code);
        Assert.Single(queue.Calls); // only the first dispatched
    }

    // ── Clean analysis → 409 retry_not_eligible ─────────────────────────────
    [SkippableFact]
    public async Task CleanOrigin_409NotEligible()
    {
        await TestDb.RequireAsync(_factory);
        var (client, queue) = NewClient();
        var (_, userId) = await AuthAsync(client, "retry-d");
        var versionId = await CreateVersionAsync(client);
        var origin = await SeedOriginAsync(
            userId, versionId, "complete", finalJson: CleanFinalJson);

        var resp = await client.PostAsync($"/api/jobs/{origin}/retry", null);
        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<ErrorEnvelopeBody>();
        Assert.Equal("retry_not_eligible", body?.Error?.Code);
        Assert.Empty(queue.Calls);
    }

    // ── invalid_file origin → 409 (already compensated; same bytes = same fail) ─
    [SkippableFact]
    public async Task InvalidFileOrigin_409NotEligible()
    {
        await TestDb.RequireAsync(_factory);
        var (client, queue) = NewClient();
        var (_, userId) = await AuthAsync(client, "retry-e");
        var versionId = await CreateVersionAsync(client);
        var origin = await SeedOriginAsync(
            userId, versionId, "failed", errorCode: "invalid_file");

        var resp = await client.PostAsync($"/api/jobs/{origin}/retry", null);
        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<ErrorEnvelopeBody>();
        Assert.Equal("retry_not_eligible", body?.Error?.Code);
        Assert.Empty(queue.Calls);
    }

    // ── Retry-of-retry → 409 (free chain capped at 1) ───────────────────────
    [SkippableFact]
    public async Task RetryOfRetry_409NotEligible()
    {
        await TestDb.RequireAsync(_factory);
        var (client, queue) = NewClient();
        var (_, userId) = await AuthAsync(client, "retry-f");
        var versionId = await CreateVersionAsync(client);
        var paidOrigin = Guid.NewGuid();
        var retryJob = await SeedOriginAsync(
            userId, versionId, "complete", finalJson: DegradedFinalJson,
            retryOfJobId: paidOrigin);

        var resp = await client.PostAsync($"/api/jobs/{retryJob}/retry", null);
        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<ErrorEnvelopeBody>();
        Assert.Equal("retry_not_eligible", body?.Error?.Code);
        Assert.Empty(queue.Calls);
    }

    // ── Someone else's job → 404 (owner-scoped at the query) ────────────────
    [SkippableFact]
    public async Task OtherUsersJob_404()
    {
        await TestDb.RequireAsync(_factory);
        var (clientA, _) = NewClient();
        var (_, ownerId) = await AuthAsync(clientA, "retry-g1");
        var versionId = await CreateVersionAsync(clientA);
        var origin = await SeedOriginAsync(
            ownerId, versionId, "complete", finalJson: DegradedFinalJson);

        var (clientB, queueB) = NewClient();
        await AuthAsync(clientB, "retry-g2");
        var resp = await clientB.PostAsync($"/api/jobs/{origin}/retry", null);
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        Assert.Empty(queueB.Calls);
    }

    // ── Version-less origin (anon-claimed file_path job) → 409 ──────────────
    [SkippableFact]
    public async Task VersionlessOrigin_409NotEligible()
    {
        await TestDb.RequireAsync(_factory);
        var (client, queue) = NewClient();
        var (_, userId) = await AuthAsync(client, "retry-h");
        var origin = await SeedOriginAsync(
            userId, versionId: null, "failed", errorCode: "worker_unavailable");

        var resp = await client.PostAsync($"/api/jobs/{origin}/retry", null);
        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<ErrorEnvelopeBody>();
        Assert.Equal("retry_not_eligible", body?.Error?.Code);
        Assert.Empty(queue.Calls);
    }

    // ── In-flight origin → 409 (nothing to retry yet) ───────────────────────
    [SkippableFact]
    public async Task ProcessingOrigin_409NotEligible()
    {
        await TestDb.RequireAsync(_factory);
        var (client, queue) = NewClient();
        var (_, userId) = await AuthAsync(client, "retry-i");
        var versionId = await CreateVersionAsync(client);
        var origin = await SeedOriginAsync(userId, versionId, "processing");

        var resp = await client.PostAsync($"/api/jobs/{origin}/retry", null);
        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        Assert.Empty(queue.Calls);
    }

    private sealed class RetryResponseBody
    {
        public Guid JobId { get; set; }
    }
    private sealed class ErrorEnvelopeBody
    {
        public ErrorEnvelopeError? Error { get; set; }
    }
    private sealed class ErrorEnvelopeError
    {
        public string? Code { get; set; }
        public string? Message { get; set; }
    }
}
