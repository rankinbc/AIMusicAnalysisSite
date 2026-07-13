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

    private WebApplicationFactory<Program> BuildConfigured(
        Action<IServiceCollection>? services = null) =>
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
            if (services is not null) builder.ConfigureServices(services);
        });


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

    [SkippableFact]
    public async Task Webhook_Missing_Signature_Header_Returns_400()
    {
        var factory = BuildConfigured();
        var client = factory.CreateClient();

        var body = StripeTestUtilities.ReadFixture("subscription_created.json");
        var resp = await PostWebhookAsync(client, body, signature: null);
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [SkippableFact]
    public async Task Webhook_Invalid_Signature_Returns_400_And_No_Event_Row()
    {
        await TestDb.RequireAsync(_factory);

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

    [SkippableFact]
    public async Task Webhook_Valid_Subscription_Created_Writes_Mirror_And_WebhookEvent()
    {
        await TestDb.RequireAsync(_factory);

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

    [SkippableFact]
    public async Task Webhook_Replay_Of_Same_Event_Is_Idempotent()
    {
        await TestDb.RequireAsync(_factory);

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

    [SkippableFact]
    public async Task Webhook_Subscription_Updated_Mutates_Existing_Mirror_Row()
    {
        await TestDb.RequireAsync(_factory);

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

    [SkippableFact]
    public async Task Webhook_Concurrent_Deliveries_Of_Same_Event_Produce_Exactly_One_Row()
    {
        // review-fix P5 / Task 4.7(e) — explicit concurrency test. Stripe
        // delivers each event at-least-once and can fan-out duplicates
        // in pathological retry scenarios. The ON CONFLICT DO NOTHING
        // primitive must collapse them to a single webhook_events row +
        // a single subscriptions row.
        await TestDb.RequireAsync(_factory);

        var factory = BuildConfigured();
        var userId = await SeedUserWithCustomerIdAsync(factory, "cus_test_001");

        try
        {
            var body = StripeTestUtilities.ReadFixture("subscription_created.json");
            var sig = StripeTestUtilities.ComputeSignatureHeader(
                body, StripeTestUtilities.TestWebhookSecret);

            // Fire three deliveries in parallel from three separate clients
            // (separate HttpClients so they don't share connection state).
            var tasks = Enumerable.Range(0, 3)
                .Select(_ => Task.Run(async () =>
                {
                    var c = factory.CreateClient();
                    return await PostWebhookAsync(c, body, sig);
                }))
                .ToArray();
            var responses = await Task.WhenAll(tasks);

            // Every response is OK (some say processed, others duplicate).
            foreach (var r in responses)
                Assert.Equal(HttpStatusCode.OK, r.StatusCode);

            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            // Exactly one webhook_events row and exactly one subscriptions row.
            Assert.Equal(1, await db.WebhookEvents
                .CountAsync(w => w.Id == "evt_test_sub_created_001"));
            Assert.Equal(1, await db.Subscriptions
                .CountAsync(s => s.UserId == userId));
        }
        finally
        {
            await CleanupAsync(factory, userId, "evt_test_sub_created_001");
        }
    }

    // ── Story 2.9 — dunning retry-date persistence ─────────────────────────

    [SkippableFact]
    public async Task Webhook_Invoice_Payment_Failed_Stamps_NextPaymentAttempt()
    {
        await TestDb.RequireAsync(_factory);

        var factory = BuildConfigured();
        var client = factory.CreateClient();
        var userId = await SeedUserWithCustomerIdAsync(factory, "cus_test_001");

        try
        {
            // Seed the mirror row first (status active, no retry pending).
            var createBody = StripeTestUtilities.ReadFixture("subscription_created.json");
            await PostWebhookAsync(client, createBody,
                StripeTestUtilities.ComputeSignatureHeader(createBody, StripeTestUtilities.TestWebhookSecret));

            // A failed renewal carries next_payment_attempt — we persist it.
            var failBody = StripeTestUtilities.ReadFixture("invoice_payment_failed.json");
            var resp = await PostWebhookAsync(client, failBody,
                StripeTestUtilities.ComputeSignatureHeader(failBody, StripeTestUtilities.TestWebhookSecret));
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var sub = await db.Subscriptions.FirstAsync(s => s.UserId == userId);
            // 1788393600 = 2026-09-04T00:00:00Z (fixture next_payment_attempt).
            Assert.Equal(
                DateTimeOffset.FromUnixTimeSeconds(1788393600),
                sub.NextPaymentAttempt);
        }
        finally
        {
            await CleanupAsync(factory, userId, "evt_test_sub_created_001");
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.WebhookEvents
                .Where(w => w.Id == "evt_test_invoice_failed_001")
                .ExecuteDeleteAsync();
        }
    }

    // ── Story 4.4 — dunning email (FR33 email half) ────────────────────────

    private sealed class RecordingEmailSender : Spectr.Bff.Services.IEmailSender
    {
        public System.Collections.Concurrent.ConcurrentQueue<(string To, string Template, IReadOnlyDictionary<string, string> Data)> Sent { get; } = new();

        public Task SendAsync(string toEmail, string template,
            IReadOnlyDictionary<string, string> data, CancellationToken ct = default)
        {
            Sent.Enqueue((toEmail, template, data));
            return Task.CompletedTask;
        }
    }

    [SkippableFact]
    public async Task Webhook_Invoice_Payment_Failed_Sends_Dunning_Email_Once_Per_Invoice()
    {
        await TestDb.RequireAsync(_factory);

        var email = new RecordingEmailSender();
        var factory = BuildConfigured(s =>
            s.AddSingleton<Spectr.Bff.Services.IEmailSender>(email));
        var client = factory.CreateClient();
        var userId = await SeedUserWithCustomerIdAsync(factory, "cus_test_001");

        try
        {
            var createBody = StripeTestUtilities.ReadFixture("subscription_created.json");
            await PostWebhookAsync(client, createBody,
                StripeTestUtilities.ComputeSignatureHeader(createBody, StripeTestUtilities.TestWebhookSecret));

            var failBody = StripeTestUtilities.ReadFixture("invoice_payment_failed.json");
            var resp = await PostWebhookAsync(client, failBody,
                StripeTestUtilities.ComputeSignatureHeader(failBody, StripeTestUtilities.TestWebhookSecret));
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

            var mail = Assert.Single(email.Sent,
                s => s.Template == Spectr.Bff.Services.EmailTemplates.Dunning);
            Assert.False(string.IsNullOrEmpty(mail.Data["nextAttempt"]));
            Assert.Contains("/billing", mail.Data["billingUrl"]);

            // Stripe re-fires payment_failed per Smart-Retry attempt — the
            // per-invoice digest ledger must dedupe. (Same event id would be
            // caught by webhook_events; simulate the retry by clearing that
            // dedupe row so only the dunning digest can stop the resend.)
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                await db.WebhookEvents
                    .Where(w => w.Id == "evt_test_invoice_failed_001")
                    .ExecuteDeleteAsync();
            }
            await PostWebhookAsync(client, failBody,
                StripeTestUtilities.ComputeSignatureHeader(failBody, StripeTestUtilities.TestWebhookSecret));
            Assert.Single(email.Sent,
                s => s.Template == Spectr.Bff.Services.EmailTemplates.Dunning);
        }
        finally
        {
            await CleanupAsync(factory, userId, "evt_test_sub_created_001");
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.WebhookEvents
                .Where(w => w.Id == "evt_test_invoice_failed_001")
                .ExecuteDeleteAsync();
            await db.Notifications
                .Where(n => n.RecipientUserId == userId)
                .ExecuteDeleteAsync();
        }
    }

    [SkippableFact]
    public async Task Webhook_Invoice_Paid_Clears_NextPaymentAttempt()
    {
        await TestDb.RequireAsync(_factory);

        var factory = BuildConfigured();
        var client = factory.CreateClient();
        var userId = await SeedUserWithCustomerIdAsync(factory, "cus_test_001");

        try
        {
            var createBody = StripeTestUtilities.ReadFixture("subscription_created.json");
            await PostWebhookAsync(client, createBody,
                StripeTestUtilities.ComputeSignatureHeader(createBody, StripeTestUtilities.TestWebhookSecret));

            // Fail → stamp a retry date.
            var failBody = StripeTestUtilities.ReadFixture("invoice_payment_failed.json");
            await PostWebhookAsync(client, failBody,
                StripeTestUtilities.ComputeSignatureHeader(failBody, StripeTestUtilities.TestWebhookSecret));

            // Pay → recovery clears it (AC #4).
            var paidBody = StripeTestUtilities.ReadFixture("invoice_paid.json");
            var resp = await PostWebhookAsync(client, paidBody,
                StripeTestUtilities.ComputeSignatureHeader(paidBody, StripeTestUtilities.TestWebhookSecret));
            Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var sub = await db.Subscriptions.FirstAsync(s => s.UserId == userId);
            Assert.Null(sub.NextPaymentAttempt);
        }
        finally
        {
            await CleanupAsync(factory, userId, "evt_test_sub_created_001");
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.WebhookEvents
                .Where(w => w.Id == "evt_test_invoice_failed_001"
                    || w.Id == "evt_test_invoice_paid_001")
                .ExecuteDeleteAsync();
        }
    }

    // ── Story 2.10 AC2 — duplicate event id must be a no-op ───────────────
    // This is a focused AC2 proof-test. Webhook_Replay_Of_Same_Event_Is_Idempotent
    // also covers this path but includes response-body assertions; this test
    // documents the DB-level guarantee explicitly for the billing-integrity story.

    [SkippableFact]
    public async Task Webhook_DuplicateEventId_IsNoOp()
    {
        await TestDb.RequireAsync(_factory);

        const string eventId = "evt_test_sub_created_001";
        var factory = BuildConfigured();
        var client = factory.CreateClient();
        var userId = await SeedUserWithCustomerIdAsync(factory, "cus_test_001");

        try
        {
            var body = StripeTestUtilities.ReadFixture("subscription_created.json");
            var sig = StripeTestUtilities.ComputeSignatureHeader(
                body, StripeTestUtilities.TestWebhookSecret);

            // First delivery — processed normally.
            var first = await PostWebhookAsync(client, body, sig);
            Assert.Equal(HttpStatusCode.OK, first.StatusCode);

            // Stripe retry — identical event id; must be a no-op.
            var sig2 = StripeTestUtilities.ComputeSignatureHeader(
                body, StripeTestUtilities.TestWebhookSecret);
            var second = await PostWebhookAsync(client, body, sig2);
            Assert.Equal(HttpStatusCode.OK, second.StatusCode);

            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            // INSERT … ON CONFLICT (id) DO NOTHING collapses to one row.
            Assert.Equal(1, await db.WebhookEvents.CountAsync(w => w.Id == eventId));
            // SubscriptionMirrorService.ApplyAsync called exactly once.
            Assert.Equal(1, await db.Subscriptions.CountAsync(s => s.UserId == userId));
        }
        finally
        {
            await CleanupAsync(factory, userId, eventId);
        }
    }

    // ── Story 2.10 AC3 — entitlement reconstruction via event replay ───────

    [SkippableFact]
    public async Task Webhook_Replay_ReconstructsSubscriptionMirror()
    {
        await TestDb.RequireAsync(_factory);

        var factory = BuildConfigured();
        var client = factory.CreateClient();
        var userId = await SeedUserWithCustomerIdAsync(factory, "cus_test_001");

        try
        {
            // 1. Created → active mirror.
            var createBody = StripeTestUtilities.ReadFixture("subscription_created.json");
            var createSig = StripeTestUtilities.ComputeSignatureHeader(
                createBody, StripeTestUtilities.TestWebhookSecret);
            var resp1 = await PostWebhookAsync(client, createBody, createSig);
            Assert.Equal(HttpStatusCode.OK, resp1.StatusCode);

            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var sub = await db.Subscriptions.FirstAsync(s => s.UserId == userId);
                Assert.Equal("active", sub.Status);
            }

            // 2. Updated → past_due.
            var updateBody = StripeTestUtilities.ReadFixture("subscription_updated.json");
            var updateSig = StripeTestUtilities.ComputeSignatureHeader(
                updateBody, StripeTestUtilities.TestWebhookSecret);
            var resp2 = await PostWebhookAsync(client, updateBody, updateSig);
            Assert.Equal(HttpStatusCode.OK, resp2.StatusCode);

            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var sub = await db.Subscriptions.FirstAsync(s => s.UserId == userId);
                Assert.Equal("past_due", sub.Status);
            }

            // 3. Recovery → active again. Replay from scratch ends here.
            var recoverBody = StripeTestUtilities.ReadFixture("subscription_recovered.json");
            var recoverSig = StripeTestUtilities.ComputeSignatureHeader(
                recoverBody, StripeTestUtilities.TestWebhookSecret);
            var resp3 = await PostWebhookAsync(client, recoverBody, recoverSig);
            Assert.Equal(HttpStatusCode.OK, resp3.StatusCode);

            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var sub = await db.Subscriptions.FirstAsync(s => s.UserId == userId);
                // Mirror reconstructed to final active state — exactly what
                // a full Stripe event replay from scratch would produce.
                Assert.Equal("active", sub.Status);
                // Still only one mirror row (upsert, not insert).
                Assert.Equal(1, await db.Subscriptions.CountAsync(s => s.UserId == userId));
            }
        }
        finally
        {
            await CleanupAsync(factory, userId, "evt_test_sub_created_001");
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.WebhookEvents
                .Where(w => w.Id == "evt_test_sub_updated_001"
                    || w.Id == "evt_test_sub_recovered_001")
                .ExecuteDeleteAsync();
        }
    }

    [SkippableFact]
    public async Task Webhook_Unsupported_Event_Type_Is_Recorded_But_Not_Processed()
    {
        await TestDb.RequireAsync(_factory);

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
