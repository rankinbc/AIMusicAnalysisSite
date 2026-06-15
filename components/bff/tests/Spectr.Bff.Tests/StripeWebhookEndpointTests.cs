using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Spectr.Data;
using System.Net;
using System.Text;
using Xunit;

namespace Spectr.Bff.Tests;

// Story 2.1 — Stripe webhook endpoint coverage. Verifies:
//   AC2 — webhook_events idempotency (insert-or-skip on event.id)
//   AC3 — only the webhook processor writes to `subscriptions`
//   AC4 — signature verification rejects unsigned/invalid payloads
//
// Stripe signature is computed locally via HMAC-SHA256 (see
// StripeTestUtilities); the SDK's EventUtility.ConstructEvent
// accepts our test signing secret.
public sealed class StripeWebhookEndpointTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    private WebApplicationFactory<Program> BuildConfigured() =>
        _factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, cfg) =>
            {
                cfg.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Stripe:SecretKey"] = "sk_test_fake",
                    ["Stripe:WebhookSecret"] = StripeTestUtilities.TestWebhookSecret,
                    ["Stripe:PriceProMonthly"] = "price_test_monthly_REPLACE_IN_DEV_SECRETS",
                    ["Stripe:PriceProAnnual"] = "price_test_annual_REPLACE_IN_DEV_SECRETS",
                });
            });
        });

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

    private static async Task<HttpResponseMessage> PostWebhookAsync(
        HttpClient client, string rawBody, string? signature)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/billing/stripe/webhook")
        {
            Content = new StringContent(rawBody, Encoding.UTF8, "application/json"),
        };
        if (signature is not null)
        {
            req.Headers.Add("Stripe-Signature", signature);
        }
        return await client.SendAsync(req);
    }

    private static async Task<Guid> SeedUserWithCustomerIdAsync(
        WebApplicationFactory<Program> factory, string customerId)
    {
        // Webhook user-resolution falls back to looking up a User row by
        // StripeCustomerId. Insert a fixed-id user so fixtures referencing
        // the same UUID + customer id resolve.
        var userId = Guid.Parse("00000000-0000-0000-0000-000000000001");
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var existing = await db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (existing is null)
        {
            db.Users.Add(new Spectr.Data.Entities.User
            {
                Id = userId,
                Email = $"webhook+{Guid.NewGuid():N}@spectr.test",
                HashedPassword = "x",
                Handle = "webhookuser",
                StripeCustomerId = customerId,
            });
            await db.SaveChangesAsync();
        }
        else if (string.IsNullOrEmpty(existing.StripeCustomerId))
        {
            existing.StripeCustomerId = customerId;
            await db.SaveChangesAsync();
        }
        return userId;
    }

    private static async Task CleanupAsync(
        WebApplicationFactory<Program> factory, Guid userId, string eventId)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Subscriptions.Where(s => s.UserId == userId).ExecuteDeleteAsync();
        await db.WebhookEvents.Where(w => w.Id == eventId).ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync();
    }

    // ── Signature verification (AC4) ───────────────────────────────────────

    [Fact]
    public async Task Webhook_Missing_Signature_Header_Returns_400()
    {
        var factory = BuildConfigured();
        var client = factory.CreateClient();

        var body = StripeTestUtilities.ReadFixture("subscription_created.json");
        var resp = await PostWebhookAsync(client, body, signature: null);
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Webhook_Invalid_Signature_Returns_400_And_No_Event_Row()
    {
        if (!await PostgresReachable()) { return; }

        var factory = BuildConfigured();
        var client = factory.CreateClient();

        var body = StripeTestUtilities.ReadFixture("subscription_created.json");
        var resp = await PostWebhookAsync(client, body, "t=1234,v1=deadbeef");
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);

        // Idempotency table must NOT receive the unverified event.
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var stored = await db.WebhookEvents
            .AnyAsync(w => w.Id == "evt_test_sub_created_001");
        Assert.False(stored);
    }

    // ── Idempotency (AC2) + dispatch (AC3) ─────────────────────────────────

    [Fact]
    public async Task Webhook_Valid_Subscription_Created_Writes_Mirror_And_WebhookEvent()
    {
        if (!await PostgresReachable()) { return; }

        var factory = BuildConfigured();
        var client = factory.CreateClient();
        var userId = await SeedUserWithCustomerIdAsync(factory, "cus_test_001");

        try
        {
            var body = StripeTestUtilities.ReadFixture("subscription_created.json");
            var sig = StripeTestUtilities.ComputeSignatureHeader(
                body, StripeTestUtilities.TestWebhookSecret);

            var resp = await PostWebhookAsync(client, body, sig);
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            // WebhookEvent row inserted and processed.
            var evt = await db.WebhookEvents
                .FirstAsync(w => w.Id == "evt_test_sub_created_001");
            Assert.Equal("customer.subscription.created", evt.EventType);
            Assert.NotNull(evt.ProcessedAt);

            // Mirror row written by SubscriptionMirrorService.
            var sub = await db.Subscriptions
                .FirstAsync(s => s.UserId == userId);
            Assert.Equal("active", sub.Status);
            Assert.Equal("sub_test_001", sub.StripeSubscriptionId);
            Assert.Equal("cus_test_001", sub.StripeCustomerId);
        }
        finally
        {
            await CleanupAsync(factory, userId, "evt_test_sub_created_001");
        }
    }

    [Fact]
    public async Task Webhook_Replay_Of_Same_Event_Is_Idempotent()
    {
        if (!await PostgresReachable()) { return; }

        var factory = BuildConfigured();
        var client = factory.CreateClient();
        var userId = await SeedUserWithCustomerIdAsync(factory, "cus_test_001");

        try
        {
            var body = StripeTestUtilities.ReadFixture("subscription_created.json");
            var sig = StripeTestUtilities.ComputeSignatureHeader(
                body, StripeTestUtilities.TestWebhookSecret);

            // First delivery — processes normally.
            var first = await PostWebhookAsync(client, body, sig);
            Assert.Equal(HttpStatusCode.OK, first.StatusCode);

            // Stripe retry — same event id; must be no-op.
            var sig2 = StripeTestUtilities.ComputeSignatureHeader(
                body, StripeTestUtilities.TestWebhookSecret);
            var second = await PostWebhookAsync(client, body, sig2);
            Assert.Equal(HttpStatusCode.OK, second.StatusCode);
            var secondBody = await second.Content.ReadAsStringAsync();
            Assert.Contains("\"duplicate\":true", secondBody);

            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            // Exactly one webhook_events row and exactly one subscriptions row.
            var evtCount = await db.WebhookEvents
                .CountAsync(w => w.Id == "evt_test_sub_created_001");
            Assert.Equal(1, evtCount);

            var subCount = await db.Subscriptions
                .CountAsync(s => s.UserId == userId);
            Assert.Equal(1, subCount);
        }
        finally
        {
            await CleanupAsync(factory, userId, "evt_test_sub_created_001");
        }
    }

    [Fact]
    public async Task Webhook_Subscription_Updated_Mutates_Existing_Mirror_Row()
    {
        if (!await PostgresReachable()) { return; }

        var factory = BuildConfigured();
        var client = factory.CreateClient();
        var userId = await SeedUserWithCustomerIdAsync(factory, "cus_test_001");

        try
        {
            // First the create event lands.
            var createBody = StripeTestUtilities.ReadFixture("subscription_created.json");
            var createSig = StripeTestUtilities.ComputeSignatureHeader(
                createBody, StripeTestUtilities.TestWebhookSecret);
            await PostWebhookAsync(client, createBody, createSig);

            // Then an update flips status to past_due.
            var updateBody = StripeTestUtilities.ReadFixture("subscription_updated.json");
            var updateSig = StripeTestUtilities.ComputeSignatureHeader(
                updateBody, StripeTestUtilities.TestWebhookSecret);
            var resp = await PostWebhookAsync(client, updateBody, updateSig);
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var sub = await db.Subscriptions
                .FirstAsync(s => s.UserId == userId);
            Assert.Equal("past_due", sub.Status);

            // Still one row (mutation, not insert).
            Assert.Equal(1, await db.Subscriptions.CountAsync(s => s.UserId == userId));
        }
        finally
        {
            await CleanupAsync(factory, userId, "evt_test_sub_created_001");
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.WebhookEvents
                .Where(w => w.Id == "evt_test_sub_updated_001")
                .ExecuteDeleteAsync();
        }
    }

    [Fact]
    public async Task Webhook_Unsupported_Event_Type_Is_Recorded_But_Not_Processed()
    {
        if (!await PostgresReachable()) { return; }

        var factory = BuildConfigured();
        var client = factory.CreateClient();

        try
        {
            var body = StripeTestUtilities.ReadFixture("unsupported_event.json");
            var sig = StripeTestUtilities.ComputeSignatureHeader(
                body, StripeTestUtilities.TestWebhookSecret);

            var resp = await PostWebhookAsync(client, body, sig);
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
            Assert.Contains("\"ignored\":true",
                await resp.Content.ReadAsStringAsync());

            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var evt = await db.WebhookEvents
                .FirstAsync(w => w.Id == "evt_test_unsupported_001");
            Assert.Equal("product.created", evt.EventType);
            Assert.Null(evt.ProcessedAt);
        }
        finally
        {
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.WebhookEvents
                .Where(w => w.Id == "evt_test_unsupported_001")
                .ExecuteDeleteAsync();
        }
    }
}
