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

// Story 2.5 (AC1, AC3, AC5) — verifies DispatchAnalysisAsync tier-routes the
// analysis enqueue to the right Dramatiq queue, and that the re-homed auxiliary
// actor (classify_stems) lands on analysis-paid (not the dead `default` queue).
// Uses RecordingJobQueue (UploadDeferralTests.cs) — Redis not needed. Gated on
// Postgres via TestDb.RequireAsync (skip-visible, story 12.7).
public sealed class DispatchQueueRoutingTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;


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

    private static async Task<(HttpClient Client, Guid UserId)> AuthAsync(HttpClient client, string prefix)
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
        form.Add(file, "file", "route-test.wav");
        form.Add(new StringContent("false"), "analyze");
        var resp = await client.PostAsync("/api/versions/", form);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<UploadResponse>();
        return body!.VersionId;
    }

    private async Task SeedCreditAsync(Guid userId, int balance)
    {
        if (balance <= 0) return;
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.CreditLedger.Add(new CreditLedgerEntry
        {
            UserId = userId,
            Amount = balance,
            Reason = "purchase",
            Reference = "pi_route_test",
            IdempotencyKey = $"credits_purchase:route_{Guid.NewGuid():N}",
        });
        await db.SaveChangesAsync();
    }

    private async Task SeedSubscriptionAsync(Guid userId, string status)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Subscriptions.Add(new Subscription
        {
            UserId = userId,
            StripeCustomerId = $"cus_route_{Guid.NewGuid():N}",
            StripeSubscriptionId = $"sub_route_{Guid.NewGuid():N}",
            Status = status,
            PriceId = "price_test",
            CurrentPeriodEnd = DateTimeOffset.UtcNow.AddDays(30),
        });
        await db.SaveChangesAsync();
    }

    private async Task<(string Task, string Queue)> DispatchAndCapture(
        HttpClient client, RecordingJobQueue queue, Guid versionId)
    {
        var resp = await client.PostAsync($"/api/versions/{versionId}/analyze", null);
        Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);
        Assert.True(queue.Enqueues.TryDequeue(out var entry), "expected one enqueue");
        return entry;
    }

    // ── (1) Free user (0 used) → analysis-free ───────────────────────────────
    [SkippableFact]
    public async Task FreeUser_RoutesToAnalysisFree()
    {
        await TestDb.RequireAsync(_factory);
        var (client, queue) = NewClient();
        await AuthAsync(client, "route-free");
        var versionId = await CreateVersionAsync(client);

        var (task, q) = await DispatchAndCapture(client, queue, versionId);
        Assert.Equal(DramatiqTasks.AnalyzeAudioJob, task);
        Assert.Equal(DramatiqQueues.AnalysisFree, q);
    }

    // ── (2) Credits user (balance ≥ 1) → analysis-paid ───────────────────────
    [SkippableFact]
    public async Task CreditsUser_RoutesToAnalysisPaid()
    {
        await TestDb.RequireAsync(_factory);
        var (client, queue) = NewClient();
        var (_, userId) = await AuthAsync(client, "route-credits");
        await SeedCreditAsync(userId, 1);
        var versionId = await CreateVersionAsync(client);

        var (task, q) = await DispatchAndCapture(client, queue, versionId);
        Assert.Equal(DramatiqTasks.AnalyzeAudioJob, task);
        Assert.Equal(DramatiqQueues.AnalysisPaid, q);
    }

    // ── (3) Pro user (active sub) → analysis-paid ────────────────────────────
    [SkippableFact]
    public async Task ProUser_Active_RoutesToAnalysisPaid()
    {
        await TestDb.RequireAsync(_factory);
        var (client, queue) = NewClient();
        var (_, userId) = await AuthAsync(client, "route-pro");
        await SeedSubscriptionAsync(userId, "active");
        var versionId = await CreateVersionAsync(client);

        var (task, q) = await DispatchAndCapture(client, queue, versionId);
        Assert.Equal(DramatiqTasks.AnalyzeAudioJob, task);
        Assert.Equal(DramatiqQueues.AnalysisPaid, q);
    }

    // ── (4) Pro past_due → analysis-paid (matches 2.4 tier table; dunning = 2.9) ─
    [SkippableFact]
    public async Task ProUser_PastDue_RoutesToAnalysisPaid()
    {
        await TestDb.RequireAsync(_factory);
        var (client, queue) = NewClient();
        var (_, userId) = await AuthAsync(client, "route-pastdue");
        await SeedSubscriptionAsync(userId, "past_due");
        var versionId = await CreateVersionAsync(client);

        var (task, q) = await DispatchAndCapture(client, queue, versionId);
        Assert.Equal(DramatiqTasks.AnalyzeAudioJob, task);
        Assert.Equal(DramatiqQueues.AnalysisPaid, q);
    }

    // ── (AC5 re-homing lock) classify_stems must enqueue on analysis-paid, not default ─
    [SkippableFact]
    public async Task ClassifyStems_RoutesToAnalysisPaid()
    {
        await TestDb.RequireAsync(_factory);
        var (client, queue) = NewClient();
        await AuthAsync(client, "route-stems");
        var versionId = await CreateVersionAsync(client);

        var resp = await client.PostAsync($"/api/versions/{versionId}/stems/classify", null);
        Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);
        Assert.True(queue.Enqueues.TryDequeue(out var entry), "expected one enqueue");
        Assert.Equal(DramatiqTasks.ClassifyStems, entry.Task);
        Assert.Equal(DramatiqQueues.AnalysisPaid, entry.Queue);
        Assert.NotEqual(DramatiqQueues.Default, entry.Queue);
    }
}
