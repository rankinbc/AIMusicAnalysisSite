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
using Stripe.Checkout;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 2.1 — billing endpoint coverage.
//   GET  /api/billing/plans                — public; returns display cents.
//   POST /api/billing/checkout/subscription — authed; creates a Stripe
//                                            Checkout session and returns
//                                            the hosted URL. Stripe SDK
//                                            is substituted via DI so
//                                            tests never hit live Stripe.
//
// Skips silently when Postgres isn't reachable (mirrors other suites).
public sealed class BillingEndpointsTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    // Fake Stripe checkout client — records every call so tests can
    // assert on what the endpoint sent without touching api.stripe.com.
    private sealed class RecordingStripeClient : IStripeCheckoutClient
    {
        public CustomerCreateOptions? LastCustomerOptions { get; set; }
        public SessionCreateOptions? LastSessionOptions { get; set; }

        public string? LastCustomerIdempotencyKey { get; set; }
        public string? LastSessionIdempotencyKey { get; set; }

        public Task<Customer> CreateCustomerAsync(
            CustomerCreateOptions options, string idempotencyKey, CancellationToken ct)
        {
            LastCustomerOptions = options;
            LastCustomerIdempotencyKey = idempotencyKey;
            return Task.FromResult(new Customer
            {
                Id = $"cus_test_{Guid.NewGuid():N}",
                Email = options.Email,
            });
        }

        public Task<Session> CreateCheckoutSessionAsync(
            SessionCreateOptions options, string idempotencyKey, CancellationToken ct)
        {
            LastSessionOptions = options;
            LastSessionIdempotencyKey = idempotencyKey;
            return Task.FromResult(new Session
            {
                Id = $"cs_test_{Guid.NewGuid():N}",
                Url = "https://checkout.stripe.com/c/cs_test_fake",
            });
        }
    }

    private (WebApplicationFactory<Program> Factory, RecordingStripeClient Stripe)
        BuildWithFakeStripe(bool configured = true)
    {
        var fake = new RecordingStripeClient();
        var f = _factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, cfg) =>
            {
                cfg.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Stripe:SecretKey"] = configured ? "sk_test_fake" : "",
                    ["Stripe:WebhookSecret"] = configured
                        ? StripeTestUtilities.TestWebhookSecret
                        : "",
                    ["Stripe:PriceProMonthly"] = configured ? "price_test_monthly" : "",
                    ["Stripe:PriceProAnnual"] = configured ? "price_test_annual" : "",
                });
            });
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll(typeof(IStripeCheckoutClient));
                services.AddSingleton<IStripeCheckoutClient>(fake);
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

    private static async Task<(HttpClient Client, Guid UserId)> SeedAuthed(
        WebApplicationFactory<Program> factory, string prefix)
    {
        var client = factory.CreateClient();
        var email = $"{prefix}+{Guid.NewGuid():N}@spectr.test";
        var reg = await client.PostAsJsonAsync(
            "/api/auth/register", new { email, password = "correct-horse-battery" });
        Assert.Equal(HttpStatusCode.OK, reg.StatusCode);
        var auth = await reg.Content.ReadFromJsonAsync<AuthResponse>();
        Assert.NotNull(auth);
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", auth!.AccessToken);
        return (client, auth.User.Id);
    }

    private static async Task CleanupUser(WebApplicationFactory<Program> factory, Guid userId)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Subscriptions.Where(s => s.UserId == userId).ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
    }

    // ── GET /plans ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Get_Plans_Returns_Display_Cents_For_Public()
    {
        var (factory, _) = BuildWithFakeStripe();
        var client = factory.CreateClient();

        var resp = await client.GetAsync("/api/billing/plans");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<PlansResponse>();
        Assert.NotNull(body);
        Assert.True(body!.ProMonthlyCents > 0);
        Assert.True(body.ProAnnualCents > 0);
        Assert.Equal("USD", body.Currency);
    }

    // ── POST /checkout/subscription ─────────────────────────────────────────

    [Fact]
    public async Task Post_Checkout_Monthly_Returns_Url_And_Creates_Stripe_Customer()
    {
        if (!await PostgresReachable()) { return; }

        var (factory, fake) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthed(factory, "billing-monthly");

        try
        {
            var resp = await client.PostAsJsonAsync(
                "/api/billing/checkout/subscription",
                new CreateCheckoutSessionRequest("monthly"));
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            var body = await resp.Content.ReadFromJsonAsync<CreateCheckoutSessionResponse>();
            Assert.NotNull(body);
            Assert.StartsWith("https://checkout.stripe.com/", body!.Url);

            // Stripe customer was created with the user metadata.
            Assert.NotNull(fake.LastCustomerOptions);
            Assert.Equal(
                userId.ToString(),
                fake.LastCustomerOptions!.Metadata["spectr_user_id"]);

            // review-fix P1 — idempotency keys are deterministic per user
            // so any retry is a no-op on Stripe's side.
            Assert.NotNull(fake.LastCustomerIdempotencyKey);
            Assert.StartsWith("customer:", fake.LastCustomerIdempotencyKey!);
            Assert.NotNull(fake.LastSessionIdempotencyKey);
            Assert.StartsWith("session:", fake.LastSessionIdempotencyKey!);

            // Session used the monthly price + automatic tax.
            Assert.NotNull(fake.LastSessionOptions);
            Assert.Equal("subscription", fake.LastSessionOptions!.Mode);
            Assert.Equal("price_test_monthly",
                fake.LastSessionOptions.LineItems[0].Price);
            Assert.True(fake.LastSessionOptions.AutomaticTax.Enabled);
            Assert.Equal(userId.ToString(),
                fake.LastSessionOptions.ClientReferenceId);

            // User row was stamped with the new customer id (reused on
            // subsequent checkouts).
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var user = await db.Users.FirstAsync(u => u.Id == userId);
            Assert.False(string.IsNullOrEmpty(user.StripeCustomerId));
        }
        finally
        {
            await CleanupUser(factory, userId);
        }
    }

    [Fact]
    public async Task Post_Checkout_Idempotency_Key_Is_Stable_Across_Cadence()
    {
        // review-fix P1 — two checkouts with the same cadence must use the
        // same session idempotency key (so a retry is a no-op); switching
        // cadence must use a DIFFERENT key (so a user who starts monthly
        // then starts annual gets the second session, not a cached one).
        if (!await PostgresReachable()) { return; }

        var (factory, fake) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthed(factory, "billing-idemp");

        try
        {
            await client.PostAsJsonAsync(
                "/api/billing/checkout/subscription",
                new CreateCheckoutSessionRequest("monthly"));
            var monthlyKey = fake.LastSessionIdempotencyKey;

            await client.PostAsJsonAsync(
                "/api/billing/checkout/subscription",
                new CreateCheckoutSessionRequest("monthly"));
            Assert.Equal(monthlyKey, fake.LastSessionIdempotencyKey);

            await client.PostAsJsonAsync(
                "/api/billing/checkout/subscription",
                new CreateCheckoutSessionRequest("annual"));
            Assert.NotEqual(monthlyKey, fake.LastSessionIdempotencyKey);
        }
        finally { await CleanupUser(factory, userId); }
    }

    [Fact]
    public async Task Post_Checkout_Annual_Uses_Annual_Price()
    {
        if (!await PostgresReachable()) { return; }

        var (factory, fake) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthed(factory, "billing-annual");

        try
        {
            var resp = await client.PostAsJsonAsync(
                "/api/billing/checkout/subscription",
                new CreateCheckoutSessionRequest("annual"));
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            Assert.Equal("price_test_annual",
                fake.LastSessionOptions!.LineItems[0].Price);
        }
        finally
        {
            await CleanupUser(factory, userId);
        }
    }

    [Fact]
    public async Task Post_Checkout_Reuses_Existing_StripeCustomerId()
    {
        if (!await PostgresReachable()) { return; }

        var (factory, fake) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthed(factory, "billing-reuse");

        try
        {
            await client.PostAsJsonAsync(
                "/api/billing/checkout/subscription",
                new CreateCheckoutSessionRequest("monthly"));
            var firstCustomerId = fake.LastSessionOptions!.Customer;

            // Reset the recorder; a second checkout should NOT create a
            // new customer.
            fake.LastCustomerOptions = null;
            await client.PostAsJsonAsync(
                "/api/billing/checkout/subscription",
                new CreateCheckoutSessionRequest("annual"));

            Assert.Null(fake.LastCustomerOptions);
            Assert.Equal(firstCustomerId, fake.LastSessionOptions.Customer);
        }
        finally
        {
            await CleanupUser(factory, userId);
        }
    }

    [Fact]
    public async Task Post_Checkout_Invalid_Cadence_Returns_400_With_AR38_Envelope()
    {
        if (!await PostgresReachable()) { return; }

        var (factory, _) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthed(factory, "billing-bad-cadence");

        try
        {
            var resp = await client.PostAsJsonAsync(
                "/api/billing/checkout/subscription",
                new CreateCheckoutSessionRequest("daily"));
            Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
            var body = await resp.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(body);
            Assert.Equal("invalid_cadence",
                doc.RootElement.GetProperty("error").GetProperty("code").GetString());
        }
        finally
        {
            await CleanupUser(factory, userId);
        }
    }

    [Fact]
    public async Task Post_Checkout_Without_StripeConfig_Returns_503()
    {
        if (!await PostgresReachable()) { return; }

        var (factory, _) = BuildWithFakeStripe(configured: false);
        var (client, userId) = await SeedAuthed(factory, "billing-noconfig");

        try
        {
            var resp = await client.PostAsJsonAsync(
                "/api/billing/checkout/subscription",
                new CreateCheckoutSessionRequest("monthly"));
            Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
            var body = await resp.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(body);
            Assert.Equal("stripe_not_configured",
                doc.RootElement.GetProperty("error").GetProperty("code").GetString());
        }
        finally
        {
            await CleanupUser(factory, userId);
        }
    }

    [Fact]
    public async Task Get_Me_Tier_Is_Free_Without_Subscription()
    {
        if (!await PostgresReachable()) { return; }

        var (factory, _) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthed(factory, "billing-tier-free");

        try
        {
            var resp = await client.GetAsync("/api/auth/me");
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            var me = await resp.Content.ReadFromJsonAsync<AuthedUser>();
            Assert.NotNull(me);
            Assert.Equal("free", me!.Tier);
        }
        finally
        {
            await CleanupUser(factory, userId);
        }
    }

    [Fact]
    public async Task Get_Me_Tier_Is_Pro_With_Active_Subscription()
    {
        if (!await PostgresReachable()) { return; }

        var (factory, _) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthed(factory, "billing-tier-pro");

        try
        {
            // Seed an active subscription row directly (mirroring what
            // the webhook would write).
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.Subscriptions.Add(new Spectr.Data.Entities.Subscription
                {
                    UserId = userId,
                    StripeCustomerId = $"cus_test_{Guid.NewGuid():N}",
                    StripeSubscriptionId = $"sub_test_{Guid.NewGuid():N}",
                    Status = "active",
                    PriceId = "price_test_monthly",
                    CurrentPeriodEnd = DateTimeOffset.UtcNow.AddDays(30),
                });
                await db.SaveChangesAsync();
            }

            var resp = await client.GetAsync("/api/auth/me");
            var me = await resp.Content.ReadFromJsonAsync<AuthedUser>();
            Assert.Equal("pro", me!.Tier);
        }
        finally
        {
            await CleanupUser(factory, userId);
        }
    }

    [Fact]
    public async Task Get_Me_Tier_Is_Free_With_Canceled_Subscription()
    {
        if (!await PostgresReachable()) { return; }

        var (factory, _) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthed(factory, "billing-tier-canceled");

        try
        {
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.Subscriptions.Add(new Spectr.Data.Entities.Subscription
                {
                    UserId = userId,
                    StripeCustomerId = $"cus_test_{Guid.NewGuid():N}",
                    StripeSubscriptionId = $"sub_test_{Guid.NewGuid():N}",
                    Status = "canceled",
                    PriceId = "price_test_monthly",
                    CurrentPeriodEnd = DateTimeOffset.UtcNow.AddDays(-5),
                });
                await db.SaveChangesAsync();
            }

            var resp = await client.GetAsync("/api/auth/me");
            var me = await resp.Content.ReadFromJsonAsync<AuthedUser>();
            Assert.Equal("free", me!.Tier);
        }
        finally
        {
            await CleanupUser(factory, userId);
        }
    }
}
