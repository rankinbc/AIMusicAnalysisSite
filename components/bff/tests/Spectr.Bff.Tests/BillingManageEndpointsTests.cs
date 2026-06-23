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

        // Story 2.10 — read-only lookups not exercised by manage-subscription
        // tests; return null so the reconciliation service (if it runs during
        // a test host startup) emits no Stripe calls.
        public Task<Stripe.Subscription?> GetSubscriptionAsync(string subscriptionId, CancellationToken ct)
            => Task.FromResult<Stripe.Subscription?>(null);

        public Task<Stripe.Price?> GetPriceAsync(string priceId, CancellationToken ct)
            => Task.FromResult<Stripe.Price?>(null);
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
        string itemId = "si_test_001",
        DateTimeOffset? nextPaymentAttempt = null)
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
            NextPaymentAttempt = nextPaymentAttempt,
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

    // ── Story 2.9 — dunning retry date round-trips on the summary ──────────
    [Fact]
    public async Task GetMe_Pro_PastDue_Returns_RetryAt()
    {
        if (!await PostgresReachable()) { return; }
        var (f, _) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthedAsync(f, "billmgr-pastdue");
        var retry = DateTimeOffset.FromUnixTimeSeconds(1788393600);
        await SeedSubscriptionAsync(f, userId, status: "past_due", nextPaymentAttempt: retry);
        try
        {
            var resp = await client.GetAsync("/api/billing/me");
            var body = await resp.Content.ReadFromJsonAsync<BillingSummaryDto>();
            // past_due keeps the Pro tier (grace window, AC #3) ...
            Assert.Equal("pro", body!.Tier);
            Assert.Equal("past_due", body.Status);
            // ... and surfaces the persisted retry date for the DunningBanner.
            Assert.Equal(retry, body.RetryAt);
        }
        finally { await CleanupAsync(f, userId); }
    }

    [Fact]
    public async Task GetMe_Pro_Active_Has_Null_RetryAt()
    {
        if (!await PostgresReachable()) { return; }
        var (f, _) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthedAsync(f, "billmgr-noretry");
        await SeedSubscriptionAsync(f, userId);
        try
        {
            var resp = await client.GetAsync("/api/billing/me");
            var body = await resp.Content.ReadFromJsonAsync<BillingSummaryDto>();
            Assert.Null(body!.RetryAt);
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
            // Story 2.2 review-fix P3 — idempotency key salted with the
            // stable StripeSubscriptionId, not the period_end timestamp.
            Assert.StartsWith("cancel:", fake.LastUpdateIdempotencyKey);
            Assert.Contains("sub_test_", fake.LastUpdateIdempotencyKey);

            // Story 2.2 review-fix P1 — response is the projected
            // post-Stripe view (architecture D2: webhook is canonical
            // writer; endpoint does not persist locally).
            var body = await resp.Content.ReadFromJsonAsync<BillingSummaryDto>();
            Assert.True(body!.CancelAtPeriodEnd);
            // Story 2.2 review-fix P22 — Currency goes null when no
            // upcoming charge exists.
            Assert.Null(body.Currency);
            Assert.Null(body.NextChargeCents);
        }
        finally { await CleanupAsync(f, userId); }
    }

    [Fact]
    public async Task PostCancel_Without_Reason_Sends_Empty_Cancel_Reason_Metadata()
    {
        // Story 2.2 review-fix P4 / D3 — metadata is ALWAYS sent with
        // the cancel_reason key (per spec text `reason ?? ""`). Sending
        // null Metadata to Stripe would clear ALL existing metadata.
        if (!await PostgresReachable()) { return; }
        var (f, fake) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthedAsync(f, "billmgr-cancel-noreason");
        await SeedSubscriptionAsync(f, userId);
        try
        {
            await client.PostAsJsonAsync(
                "/api/billing/cancel", new CancelSubscriptionRequest(null));
            Assert.NotNull(fake.LastUpdateOptions!.Metadata);
            Assert.Equal(string.Empty,
                fake.LastUpdateOptions.Metadata!["cancel_reason"]);
        }
        finally { await CleanupAsync(f, userId); }
    }

    [Fact]
    public async Task PostCancel_Already_Canceling_Returns_409()
    {
        // Story 2.2 review-fix P7 — double-cancel is a 409 short-circuit,
        // not a wasted Stripe roundtrip.
        if (!await PostgresReachable()) { return; }
        var (f, fake) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthedAsync(f, "billmgr-already-canc");
        await SeedSubscriptionAsync(
            f, userId, cancelAt: DateTimeOffset.UtcNow.AddDays(30));
        try
        {
            var resp = await client.PostAsJsonAsync(
                "/api/billing/cancel", new CancelSubscriptionRequest(null));
            Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            Assert.Equal("already_canceling",
                doc.RootElement.GetProperty("error").GetProperty("code").GetString());
            // Stripe was NOT called (short-circuited locally).
            Assert.Null(fake.LastUpdateOptions);
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
            // Story 2.2 review-fix P3 — key salted with subscription id.
            Assert.StartsWith("resubscribe:", fake.LastUpdateIdempotencyKey);
            Assert.Contains("sub_test_", fake.LastUpdateIdempotencyKey);
            // Story 2.2 review-fix P5 — metadata sent with empty
            // cancel_reason (clears the prior reason; does NOT pass
            // null which would wipe other metadata).
            Assert.NotNull(fake.LastUpdateOptions.Metadata);
            Assert.Equal(string.Empty,
                fake.LastUpdateOptions.Metadata!["cancel_reason"]);
            var body = await resp.Content.ReadFromJsonAsync<BillingSummaryDto>();
            Assert.False(body!.CancelAtPeriodEnd);
            // Currency comes back (active state has an upcoming charge).
            Assert.Equal("USD", body.Currency);
        }
        finally { await CleanupAsync(f, userId); }
    }

    [Fact]
    public async Task PostResubscribe_On_Terminated_Subscription_Returns_409()
    {
        // Story 2.2 review-fix P6 — once status flips past active/
        // trialing/past_due (e.g. webhook delivered `canceled` after
        // period end), resubscribe must reject up-front instead of
        // letting Stripe's 400 surface as a 500.
        if (!await PostgresReachable()) { return; }
        var (f, fake) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthedAsync(f, "billmgr-resub-terminated");
        await SeedSubscriptionAsync(
            f, userId,
            status: "canceled",
            cancelAt: DateTimeOffset.UtcNow.AddDays(-1));
        try
        {
            var resp = await client.PostAsync("/api/billing/resubscribe", null);
            Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            Assert.Equal("no_active_subscription",
                doc.RootElement.GetProperty("error").GetProperty("code").GetString());
            Assert.Null(fake.LastUpdateOptions);
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
            // Story 2.2 review-fix P11 — key includes subscription id +
            // period_end + target price so a retry across cycles or a
            // round-trip in the same cycle don't collide.
            Assert.Contains("price_test_annual", fake.LastUpdateIdempotencyKey);
            Assert.Contains("sub_test_", fake.LastUpdateIdempotencyKey);

            var body = await resp.Content.ReadFromJsonAsync<BillingSummaryDto>();
            Assert.Equal("annual", body!.Cadence);
            // The projected response reflects the new price → new
            // monthly-cents = annual price.
            Assert.Equal(9900, body.NextChargeCents);
        }
        finally { await CleanupAsync(f, userId); }
    }

    [Fact]
    public async Task PostChangeCadence_While_Pending_Cancel_Returns_409()
    {
        // Story 2.2 review-fix P10 — cadence swap on a sub pending
        // cancellation would trigger a surprise proration charge.
        if (!await PostgresReachable()) { return; }
        var (f, fake) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthedAsync(f, "billmgr-cadence-pending");
        await SeedSubscriptionAsync(
            f, userId,
            priceId: "price_test_monthly",
            cancelAt: DateTimeOffset.UtcNow.AddDays(20));
        try
        {
            var resp = await client.PostAsJsonAsync(
                "/api/billing/change-cadence", new ChangeCadenceRequest("annual"));
            Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            Assert.Equal("subscription_pending_cancel",
                doc.RootElement.GetProperty("error").GetProperty("code").GetString());
            Assert.Null(fake.LastUpdateOptions);
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
    public async Task PostPortal_Returns_Stripe_Hosted_Url_With_Billing_Return_Path()
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
            // Story 2.2 review-fix P30 — verify the ReturnUrl passed to
            // Stripe lands the user back on the self-service billing
            // page (not the checkout-success page from string-munged
            // SuccessUrl, which was the P2 bug).
            Assert.NotNull(fake.LastPortalOptions);
            Assert.EndsWith("/billing", fake.LastPortalOptions!.ReturnUrl);
            Assert.DoesNotContain("session_id", fake.LastPortalOptions.ReturnUrl);
        }
        finally { await CleanupAsync(f, userId); }
    }

    [Fact]
    public async Task PostCancel_Without_Stripe_Config_Returns_503()
    {
        if (!await PostgresReachable()) { return; }
        var (f, _) = BuildWithFakeStripe(configured: false);
        var (client, userId) = await SeedAuthedAsync(f, "billmgr-noconfig-cancel");
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

    // Story 2.2 review-fix P16 — Task 10.1(g) required `POST /portal`
    // 503-no-config coverage. Adding parallels for /resubscribe and
    // /change-cadence so the no-config guard on every mutating endpoint
    // is locked.

    [Fact]
    public async Task PostResubscribe_Without_Stripe_Config_Returns_503()
    {
        if (!await PostgresReachable()) { return; }
        var (f, _) = BuildWithFakeStripe(configured: false);
        var (client, userId) = await SeedAuthedAsync(f, "billmgr-noconfig-resub");
        try
        {
            var resp = await client.PostAsync("/api/billing/resubscribe", null);
            Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            Assert.Equal("stripe_not_configured",
                doc.RootElement.GetProperty("error").GetProperty("code").GetString());
        }
        finally { await CleanupAsync(f, userId); }
    }

    [Fact]
    public async Task PostChangeCadence_Without_Stripe_Config_Returns_503()
    {
        if (!await PostgresReachable()) { return; }
        var (f, _) = BuildWithFakeStripe(configured: false);
        var (client, userId) = await SeedAuthedAsync(f, "billmgr-noconfig-cad");
        try
        {
            var resp = await client.PostAsJsonAsync(
                "/api/billing/change-cadence", new ChangeCadenceRequest("annual"));
            Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            Assert.Equal("stripe_not_configured",
                doc.RootElement.GetProperty("error").GetProperty("code").GetString());
        }
        finally { await CleanupAsync(f, userId); }
    }

    [Fact]
    public async Task PostPortal_Without_Stripe_Config_Returns_503()
    {
        if (!await PostgresReachable()) { return; }
        var (f, _) = BuildWithFakeStripe(configured: false);
        var (client, userId) = await SeedAuthedAsync(f, "billmgr-noconfig-portal");
        try
        {
            var resp = await client.PostAsync("/api/billing/portal", null);
            Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            Assert.Equal("stripe_not_configured",
                doc.RootElement.GetProperty("error").GetProperty("code").GetString());
        }
        finally { await CleanupAsync(f, userId); }
    }
}
