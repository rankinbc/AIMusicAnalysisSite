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

// Story 2.3 / Task 10.1 — integration tests for the credit-pack
// checkout endpoint, GET /credits, and the webhook dispatch path for
// checkout.session.completed mode=payment.

public sealed class BillingCreditsEndpointsTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private sealed class RecordingCheckoutClient : IStripeCheckoutClient
    {
        public SessionCreateOptions? LastSessionOptions { get; set; }
        public string? LastSessionIdempotencyKey { get; set; }

        public Task<Customer> CreateCustomerAsync(
            CustomerCreateOptions options, string idempotencyKey, CancellationToken ct)
            => Task.FromResult(new Customer
            {
                Id = $"cus_test_{Guid.NewGuid():N}",
                Email = options.Email,
            });

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

    private (WebApplicationFactory<Program> F, RecordingCheckoutClient Client)
        BuildWithFakeStripe(bool configured = true, bool creditsConfigured = true)
    {
        var fake = new RecordingCheckoutClient();
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
                    ["Stripe:PriceCreditPack5"] = creditsConfigured ? "price_test_pack5" : "",
                    ["Stripe:PriceCreditPack10"] = creditsConfigured ? "price_test_pack10" : "",
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

    private static async Task CleanupAsync(WebApplicationFactory<Program> factory, Guid userId)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await TestAuth.AllowPurgeAsync(db);
        await db.CreditLedger.Where(e => e.UserId == userId).ExecuteDeleteAsync();
        await db.UsageEvents.Where(e => e.UserId == userId).ExecuteDeleteAsync();
        await db.WebhookEvents
            .Where(w => w.EventType.StartsWith("checkout.") || w.EventType.StartsWith("customer."))
            .ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
    }

    // ── POST /checkout/credits ─────────────────────────────────────────────

    [SkippableFact]
    public async Task PostCheckoutCredits_With_Pack5_Returns_Stripe_Url()
    {
        await TestDb.RequireAsync(_factory);
        var (f, fake) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthedAsync(f, "credits-5");
        try
        {
            var resp = await client.PostAsJsonAsync(
                "/api/billing/checkout/credits", new BuyCreditsRequest(5));
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            var body = await resp.Content.ReadFromJsonAsync<CreateCheckoutSessionResponse>();
            Assert.StartsWith("https://checkout.stripe.com/", body!.Url);

            // Session created with mode=payment + the 5-pack price + metadata.
            Assert.NotNull(fake.LastSessionOptions);
            Assert.Equal("payment", fake.LastSessionOptions!.Mode);
            Assert.Equal("price_test_pack5", fake.LastSessionOptions.LineItems![0].Price);
            // Review-fix P1-A: session-level Metadata must carry user+pack so the
            // checkout.session.completed webhook can read session.Metadata (not
            // PaymentIntent.Metadata, which is a separate Stripe object).
            Assert.NotNull(fake.LastSessionOptions.Metadata);
            Assert.Equal(userId.ToString(),
                fake.LastSessionOptions.Metadata!["spectr_user_id"]);
            Assert.Equal("5", fake.LastSessionOptions.Metadata["pack_size"]);
            // PaymentIntent-level copy (defense-in-depth for PI webhooks).
            Assert.Equal(userId.ToString(),
                fake.LastSessionOptions.PaymentIntentData!.Metadata!["spectr_user_id"]);
            Assert.Equal("5",
                fake.LastSessionOptions.PaymentIntentData.Metadata["pack_size"]);
            Assert.StartsWith("credits_session:", fake.LastSessionIdempotencyKey);
            Assert.Contains(":5:", fake.LastSessionIdempotencyKey);
        }
        finally { await CleanupAsync(f, userId); }
    }

    [SkippableFact]
    public async Task PostCheckoutCredits_With_Invalid_Pack_Size_Returns_400()
    {
        await TestDb.RequireAsync(_factory);
        var (f, _) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthedAsync(f, "credits-invalid");
        try
        {
            var resp = await client.PostAsJsonAsync(
                "/api/billing/checkout/credits", new BuyCreditsRequest(7));
            Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            Assert.Equal("invalid_pack_size",
                doc.RootElement.GetProperty("error").GetProperty("code").GetString());
        }
        finally { await CleanupAsync(f, userId); }
    }

    [SkippableFact]
    public async Task PostCheckoutCredits_Without_Credit_Pack_Config_Returns_503()
    {
        await TestDb.RequireAsync(_factory);
        var (f, _) = BuildWithFakeStripe(configured: true, creditsConfigured: false);
        var (client, userId) = await SeedAuthedAsync(f, "credits-no-pack-config");
        try
        {
            var resp = await client.PostAsJsonAsync(
                "/api/billing/checkout/credits", new BuyCreditsRequest(5));
            Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
            Assert.Equal("stripe_not_configured",
                doc.RootElement.GetProperty("error").GetProperty("code").GetString());
        }
        finally { await CleanupAsync(f, userId); }
    }

    // ── GET /credits ───────────────────────────────────────────────────────

    [SkippableFact]
    public async Task GetCredits_Returns_Balance_And_Entries()
    {
        await TestDb.RequireAsync(_factory);
        var (f, _) = BuildWithFakeStripe();
        var (client, userId) = await SeedAuthedAsync(f, "credits-get");
        try
        {
            // Seed a purchase + spend directly via the service.
            using (var scope = f.Services.CreateScope())
            {
                var svc = scope.ServiceProvider.GetRequiredService<CreditLedgerService>();
                await svc.PurchaseAsync(userId, 5, "pi_seed_get",
                    "credits_purchase:get_seed", CancellationToken.None);
                await svc.SpendAsync(userId, Guid.NewGuid(),
                    "2026-06", CancellationToken.None);
            }

            var resp = await client.GetAsync("/api/billing/credits");
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            var body = await resp.Content.ReadFromJsonAsync<CreditsResponse>();
            Assert.NotNull(body);
            Assert.Equal(4, body!.Balance);
            Assert.Equal(2, body.Entries.Count);
            // DESC order: newest (spend) first.
            Assert.Equal(-1, body.Entries[0].Amount);
            Assert.Equal("spend", body.Entries[0].Reason);
            Assert.Equal(5, body.Entries[1].Amount);
            Assert.Equal("purchase", body.Entries[1].Reason);
            Assert.Null(body.NextCursor);
        }
        finally { await CleanupAsync(f, userId); }
    }

    // ── Webhook: checkout.session.completed mode=payment ───────────────────

    [SkippableFact]
    public async Task Webhook_CheckoutSession_Payment_Mode_Appends_Purchase_Ledger_Row()
    {
        await TestDb.RequireAsync(_factory);
        var (f, _) = BuildWithFakeStripe();
        var (_, userId) = await SeedAuthedAsync(f, "credits-webhook");
        try
        {
            var payload = BuildPaymentSessionEvent(
                eventId: $"evt_webhook_pay_{Guid.NewGuid():N}",
                userId: userId,
                packSize: 5,
                paymentIntentId: "pi_webhook_001");
            var signature = StripeTestUtilities.ComputeSignatureHeader(
                payload, StripeTestUtilities.TestWebhookSecret);

            using var anonClient = f.CreateClient();
            var req = new HttpRequestMessage(HttpMethod.Post, "/api/billing/stripe/webhook")
            {
                Content = new StringContent(payload, System.Text.Encoding.UTF8, "application/json"),
            };
            req.Headers.Add("Stripe-Signature", signature);
            var resp = await anonClient.SendAsync(req);
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var rows = await db.CreditLedger.Where(e => e.UserId == userId).ToListAsync();
            Assert.Single(rows);
            Assert.Equal(5, rows[0].Amount);
            Assert.Equal("purchase", rows[0].Reason);
            Assert.Equal("pi_webhook_001", rows[0].Reference);
        }
        finally { await CleanupAsync(f, userId); }
    }

    [SkippableFact]
    public async Task Webhook_CheckoutSession_Payment_Mode_Replay_Is_Idempotent()
    {
        await TestDb.RequireAsync(_factory);
        var (f, _) = BuildWithFakeStripe();
        var (_, userId) = await SeedAuthedAsync(f, "credits-webhook-replay");
        try
        {
            var eventId = $"evt_replay_{Guid.NewGuid():N}";
            var payload = BuildPaymentSessionEvent(
                eventId: eventId, userId: userId,
                packSize: 10, paymentIntentId: "pi_replay_001");
            var signature = StripeTestUtilities.ComputeSignatureHeader(
                payload, StripeTestUtilities.TestWebhookSecret);

            using var anonClient = f.CreateClient();
            for (var i = 0; i < 2; i++)
            {
                var req = new HttpRequestMessage(HttpMethod.Post, "/api/billing/stripe/webhook")
                {
                    Content = new StringContent(payload, System.Text.Encoding.UTF8, "application/json"),
                };
                req.Headers.Add("Stripe-Signature", signature);
                var resp = await anonClient.SendAsync(req);
                Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            }

            using var scope = f.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var rows = await db.CreditLedger.Where(e => e.UserId == userId).ToListAsync();
            Assert.Single(rows);
            Assert.Equal(10, rows[0].Amount);
        }
        finally { await CleanupAsync(f, userId); }
    }

    private static string BuildPaymentSessionEvent(
        string eventId, Guid userId, int packSize, string paymentIntentId)
    {
        // Minimal Stripe event shape for checkout.session.completed in
        // mode=payment. The webhook handler only reads:
        //   data.object.mode, data.object.id, data.object.payment_intent,
        //   data.object.metadata.{spectr_user_id, pack_size}
        // Real Stripe payloads carry many more fields; we ship only what
        // the handler needs.
        var obj = new
        {
            id = $"cs_test_{Guid.NewGuid():N}",
            @object = "checkout.session",
            mode = "payment",
            payment_intent = paymentIntentId,
            metadata = new Dictionary<string, string>
            {
                ["spectr_user_id"] = userId.ToString(),
                ["pack_size"] = packSize.ToString(),
            },
        };
        var envelope = new
        {
            id = eventId,
            @object = "event",
            type = "checkout.session.completed",
            api_version = "2024-06-20",
            created = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            data = new { @object = obj },
        };
        return JsonSerializer.Serialize(envelope);
    }
}
