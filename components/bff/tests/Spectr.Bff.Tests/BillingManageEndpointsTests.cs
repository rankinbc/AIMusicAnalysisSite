using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Spectr.Bff.DTOs;
using Spectr.Bff.Services;
using Spectr.Data;
using Stripe;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;
using StripeBillingPortalSession = Stripe.BillingPortal.Session;
using StripeBillingPortalSessionCreateOptions = Stripe.BillingPortal.SessionCreateOptions;

namespace Spectr.Bff.Tests;

// Story 2.2 Task 10.1 — integration tests for the 5 manage-subscription
// endpoints. Stripe SDK substituted via DI; tests never hit api.stripe.com.
public sealed class BillingManageEndpointsTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    // Recording fake — captures every call + lets the test choose what
    // Stripe "returns" so we can simulate cancel/reactivate/swap-price.
    private sealed class RecordingStripeSubscriptionClient : IStripeSubscriptionClient
    {
        public string? LastSubscriptionId { get; set; }
        public SubscriptionUpdateOptions? LastUpdateOptions { get; set; }
        public string? LastUpdateIdempotencyKey { get; set; }
        public StripeBillingPortalSessionCreateOptions? LastPortalOptions { get; set; }
        public string? LastPortalIdempotencyKey { get; set; }

        public Task<Stripe.Subscription> UpdateAsync(
            string subscriptionId, SubscriptionUpdateOptions options,
            string idempotencyKey, CancellationToken ct)
        {
            LastSubscriptionId = subscriptionId;
            LastUpdateOptions = options;
            LastUpdateIdempotencyKey = idempotencyKey;
            return Task.FromResult(new Stripe.Subscription
            {
                Id = subscriptionId,
                Status = "active",
            });
        }

        public Task<StripeBillingPortalSession> CreatePortalSessionAsync(
            StripeBillingPortalSessionCreateOptions options,
            string idempotencyKey, CancellationToken ct)
        {
            LastPortalOptions = options;
            LastPortalIdempotencyKey = idempotencyKey;
            return Task.FromResult(new StripeBillingPortalSession
            {
                Id = $"bps_test_{Guid.NewGuid():N}",
                Url = "https://billing.stripe.com/p/session/fake",
            });
        }
    }

    private (WebApplicationFactory<Program> F, RecordingStripeSubscriptionClient Subs)
        BuildWithFakeStripe(bool configured = true)
    {
        var fake = new RecordingStripeSubscriptionClient();
        var f = _factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, cfg) =>
            {
                cfg.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Stripe:SecretKey"] = configured ? "sk_test_fake" : "",
                    ["Stripe:WebhookSecret"] = configured
                        ? StripeTestUtilities.TestWebhookSecret : "",
                    ["Stripe:PriceProMonthly"] = configured ? "price_test_monthly" : "",
                    ["Stripe:PriceProAnnual"] = configured ? "price_test_annual" : "",
                });
            });
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll(typeof(IStripeSubscriptionClient));
                services.AddSingleton<IStripeSubscriptionClient>(fake);
            });
        });
        return (f, fake);
    }

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

    private static async Task SeedSubscriptionAsync(
        WebApplicationFactory<Program> factory,
        Guid userId,
        string status = "active",
        string priceId = "price_test_monthly",
        DateTimeOffset? cancelAt = null,
        string itemId = "si_test_001")
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = await db.Users.FirstAsync(u => u.Id == userId);
        if (string.IsNullOrEmpty(user.StripeCustomerId))
        {
            user.StripeCustomerId = $"cus_test_{Guid.NewGuid():N}";
        }
        db.Subscriptions.Add(new Spectr.Data.Entities.Subscription
        {
            UserId = userId,
            StripeCustomerId = user.StripeCustomerId!,
            StripeSubscriptionId = $"sub_test_{Guid.NewGuid():N}",
            StripeItemId = itemId,
            Status = status,
            PriceId = priceId,
            CurrentPeriodEnd = DateTimeOffset.UtcNow.AddDays(30),
            CancelAt = cancelAt,
        });
        await db.SaveChangesAsync();
    }

    private static async Task CleanupAsync(WebApplicationFactory<Program> factory, Guid userId)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Subscriptions.Where(s => s.UserId == userId).ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
    }

    // ── GET /me ────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetMe_Free_User_Returns_Free_Tier_Summary()
    {
        if (!await PostgresReachable()) { return; }
        var (f, _) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthedAsync(f, "billmgr-free");
        try
        {
            var resp = await client.GetAsync("/api/billing/me");
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            var body = await resp.Content.ReadFromJsonAsync<BillingSummaryDto>();
            Assert.NotNull(body);
            Assert.Equal("free", body!.Tier);
            Assert.Null(body.Status);
            Assert.Null(body.Cadence);
            Assert.False(body.CancelAtPeriodEnd);
        }
        finally { await CleanupAsync(f, userId); }
    }

    [Fact]
    public async Task GetMe_Pro_Active_Returns_Monthly_Cadence_And_Next_Charge()
    {
        if (!await PostgresReachable()) { return; }
        var (f, _) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthedAsync(f, "billmgr-active");
        await SeedSubscriptionAsync(f, userId);
        try
        {
            var resp = await client.GetAsync("/api/billing/me");
            var body = await resp.Content.ReadFromJsonAsync<BillingSummaryDto>();
            Assert.Equal("pro", body!.Tier);
            Assert.Equal("active", body.Status);
            Assert.Equal("monthly", body.Cadence);
            Assert.False(body.CancelAtPeriodEnd);
            Assert.NotNull(body.NextChargeAt);
            Assert.Equal(1299, body.NextChargeCents);
            Assert.Equal("USD", body.Currency);
        }
        finally { await CleanupAsync(f, userId); }
    }

    [Fact]
    public async Task GetMe_Pro_Canceled_Hides_NextCharge()
    {
        if (!await PostgresReachable()) { return; }
        var (f, _) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthedAsync(f, "billmgr-canc");
        await SeedSubscriptionAsync(f, userId, cancelAt: DateTimeOffset.UtcNow.AddDays(30));
        try
        {
            var resp = await client.GetAsync("/api/billing/me");
            var body = await resp.Content.ReadFromJsonAsync<BillingSummaryDto>();
            Assert.True(body!.CancelAtPeriodEnd);
            Assert.Null(body.NextChargeAt);
            Assert.Null(body.NextChargeCents);
            Assert.NotNull(body.CurrentPeriodEnd);
        }
        finally { await CleanupAsync(f, userId); }
    }

    // ── POST /cancel ───────────────────────────────────────────────────────

    [Fact]
    public async Task PostCancel_Without_Active_Subscription_Returns_409()
    {
        if (!await PostgresReachable()) { return; }
        var (f, _) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthedAsync(f, "billmgr-cancel-free");
        try
        {
            var resp = await client.PostAsJsonAsync(
                "/api/billing/cancel", new CancelSubscriptionRequest("too_expensive"));
            Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            Assert.Equal("no_active_subscription",
                doc.RootElement.GetProperty("error").GetProperty("code").GetString());
        }
        finally { await CleanupAsync(f, userId); }
    }

    [Fact]
    public async Task PostCancel_Flips_CancelAtPeriodEnd_Via_Stripe()
    {
        if (!await PostgresReachable()) { return; }
        var (f, fake) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthedAsync(f, "billmgr-cancel-ok");
        await SeedSubscriptionAsync(f, userId);
        try
        {
            var resp = await client.PostAsJsonAsync(
                "/api/billing/cancel", new CancelSubscriptionRequest("too_expensive"));
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            // Stripe Update called with CancelAtPeriodEnd=true + reason metadata.
            Assert.True(fake.LastUpdateOptions!.CancelAtPeriodEnd);
            Assert.Equal("too_expensive",
                fake.LastUpdateOptions.Metadata!["cancel_reason"]);
            Assert.StartsWith("cancel:", fake.LastUpdateIdempotencyKey);

            // Response reflects optimistic mirror update.
            var body = await resp.Content.ReadFromJsonAsync<BillingSummaryDto>();
            Assert.True(body!.CancelAtPeriodEnd);
        }
        finally { await CleanupAsync(f, userId); }
    }

    [Fact]
    public async Task PostCancel_Without_Reason_Does_Not_Send_Metadata()
    {
        if (!await PostgresReachable()) { return; }
        var (f, fake) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthedAsync(f, "billmgr-cancel-noreason");
        await SeedSubscriptionAsync(f, userId);
        try
        {
            await client.PostAsJsonAsync(
                "/api/billing/cancel", new CancelSubscriptionRequest(null));
            Assert.Null(fake.LastUpdateOptions!.Metadata);
        }
        finally { await CleanupAsync(f, userId); }
    }

    // ── POST /resubscribe ──────────────────────────────────────────────────

    [Fact]
    public async Task PostResubscribe_Without_Pending_Cancel_Returns_409()
    {
        if (!await PostgresReachable()) { return; }
        var (f, _) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthedAsync(f, "billmgr-resub-none");
        await SeedSubscriptionAsync(f, userId); // no cancelAt
        try
        {
            var resp = await client.PostAsync("/api/billing/resubscribe", null);
            Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            Assert.Equal("not_pending_cancel",
                doc.RootElement.GetProperty("error").GetProperty("code").GetString());
        }
        finally { await CleanupAsync(f, userId); }
    }

    [Fact]
    public async Task PostResubscribe_Reverses_Cancel()
    {
        if (!await PostgresReachable()) { return; }
        var (f, fake) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthedAsync(f, "billmgr-resub-ok");
        await SeedSubscriptionAsync(
            f, userId, cancelAt: DateTimeOffset.UtcNow.AddDays(30));
        try
        {
            var resp = await client.PostAsync("/api/billing/resubscribe", null);
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            Assert.False(fake.LastUpdateOptions!.CancelAtPeriodEnd);
            Assert.StartsWith("resubscribe:", fake.LastUpdateIdempotencyKey);
            var body = await resp.Content.ReadFromJsonAsync<BillingSummaryDto>();
            Assert.False(body!.CancelAtPeriodEnd);
        }
        finally { await CleanupAsync(f, userId); }
    }

    // ── POST /change-cadence ───────────────────────────────────────────────

    [Fact]
    public async Task PostChangeCadence_Same_Cadence_Returns_409()
    {
        if (!await PostgresReachable()) { return; }
        var (f, _) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthedAsync(f, "billmgr-same");
        await SeedSubscriptionAsync(f, userId, priceId: "price_test_monthly");
        try
        {
            var resp = await client.PostAsJsonAsync(
                "/api/billing/change-cadence", new ChangeCadenceRequest("monthly"));
            Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            Assert.Equal("same_cadence",
                doc.RootElement.GetProperty("error").GetProperty("code").GetString());
        }
        finally { await CleanupAsync(f, userId); }
    }

    [Fact]
    public async Task PostChangeCadence_Annual_Swaps_Price_With_Proration()
    {
        if (!await PostgresReachable()) { return; }
        var (f, fake) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthedAsync(f, "billmgr-swap");
        await SeedSubscriptionAsync(f, userId, priceId: "price_test_monthly");
        try
        {
            var resp = await client.PostAsJsonAsync(
                "/api/billing/change-cadence", new ChangeCadenceRequest("annual"));
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            Assert.Equal("price_test_annual",
                fake.LastUpdateOptions!.Items![0].Price);
            Assert.Equal("create_prorations",
                fake.LastUpdateOptions.ProrationBehavior);
            Assert.Contains("price_test_annual", fake.LastUpdateIdempotencyKey);

            var body = await resp.Content.ReadFromJsonAsync<BillingSummaryDto>();
            Assert.Equal("annual", body!.Cadence);
        }
        finally { await CleanupAsync(f, userId); }
    }

    [Fact]
    public async Task PostChangeCadence_With_Null_StripeItemId_Returns_409()
    {
        if (!await PostgresReachable()) { return; }
        var (f, _) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthedAsync(f, "billmgr-notready");
        await SeedSubscriptionAsync(f, userId, itemId: null!);
        try
        {
            var resp = await client.PostAsJsonAsync(
                "/api/billing/change-cadence", new ChangeCadenceRequest("annual"));
            Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            Assert.Equal("subscription_not_ready",
                doc.RootElement.GetProperty("error").GetProperty("code").GetString());
        }
        finally { await CleanupAsync(f, userId); }
    }

    // ── POST /portal ───────────────────────────────────────────────────────

    [Fact]
    public async Task PostPortal_Without_Stripe_Customer_Returns_409()
    {
        if (!await PostgresReachable()) { return; }
        var (f, _) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthedAsync(f, "billmgr-portal-nocust");
        try
        {
            var resp = await client.PostAsync("/api/billing/portal", null);
            Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            Assert.Equal("no_stripe_customer",
                doc.RootElement.GetProperty("error").GetProperty("code").GetString());
        }
        finally { await CleanupAsync(f, userId); }
    }

    [Fact]
    public async Task PostPortal_Returns_Stripe_Hosted_Url()
    {
        if (!await PostgresReachable()) { return; }
        var (f, fake) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthedAsync(f, "billmgr-portal-ok");
        await SeedSubscriptionAsync(f, userId);
        try
        {
            var resp = await client.PostAsync("/api/billing/portal", null);
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            var body = await resp.Content.ReadFromJsonAsync<CreatePortalSessionResponse>();
            Assert.StartsWith("https://billing.stripe.com/", body!.Url);
            Assert.StartsWith("portal:", fake.LastPortalIdempotencyKey);
        }
        finally { await CleanupAsync(f, userId); }
    }

    [Fact]
    public async Task PostCancel_Without_Stripe_Config_Returns_503()
    {
        if (!await PostgresReachable()) { return; }
        var (f, _) = BuildWithFakeStripe(configured: false);
        var (client, userId) = await SeedAuthedAsync(f, "billmgr-noconfig");
        try
        {
            var resp = await client.PostAsJsonAsync(
                "/api/billing/cancel", new CancelSubscriptionRequest(null));
            Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            Assert.Equal("stripe_not_configured",
                doc.RootElement.GetProperty("error").GetProperty("code").GetString());
        }
        finally { await CleanupAsync(f, userId); }
    }
}
