using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Spectr.Bff.Auth;
using Spectr.Bff.DTOs;
using Spectr.Bff.Options;
using Spectr.Bff.Services;
using Spectr.Data;
using Stripe;
using Stripe.Checkout;

namespace Spectr.Bff.Endpoints;

// Story 2.1 — Subscribe to Pro via Stripe Checkout.
//
//   GET  /api/billing/plans              — public; display cents for the
//                                          pricing page (AR39 no inline literals)
//   POST /api/billing/checkout/subscription — authed; creates a hosted
//                                          Checkout session, returns URL
//   POST /api/billing/stripe/webhook     — anonymous; Stripe-signed payloads
//                                          only; AR11 idempotency via
//                                          webhook_events table.
//
// The webhook endpoint is the ONLY caller that writes to `subscriptions`
// (architecture money-boundary rule). All other reads of `subscriptions`
// (e.g. /me's tier derivation) MUST be read-only.

public static class BillingEndpoints
{
    private static readonly HashSet<string> SupportedSubscriptionEvents = new()
    {
        "checkout.session.completed",
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "invoice.paid",
        "invoice.payment_failed",
    };

    public static IEndpointRouteBuilder MapBillingEndpoints(this IEndpointRouteBuilder app)
    {
        var billing = app.MapGroup("/billing").WithTags("billing");

        // Public display values for the pricing page.
        billing.MapGet("/plans", GetPlans).AllowAnonymous();

        // Authed checkout entry point.
        billing.MapPost("/checkout/subscription", PostCheckoutSubscription)
            .RequireAuthorization();

        // Anonymous because Stripe webhooks don't carry a user session;
        // they authenticate via the Stripe-Signature header instead.
        billing.MapPost("/stripe/webhook", PostStripeWebhook).AllowAnonymous();

        return app;
    }

    // ── GET /plans ──────────────────────────────────────────────────────────

    private static IResult GetPlans(IOptions<PricingDisplayOptions> opts)
    {
        var o = opts.Value;
        return Results.Ok(new PlansResponse(
            ProMonthlyCents: o.ProMonthlyCents,
            ProAnnualCents: o.ProAnnualCents,
            Currency: o.Currency));
    }

    // ── POST /checkout/subscription ─────────────────────────────────────────

    private static async Task<IResult> PostCheckoutSubscription(
        CreateCheckoutSessionRequest body,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IOptions<StripeOptions> stripeOpts,
        IStripeCheckoutClient stripeClient,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var opts = stripeOpts.Value;

        if (body is null || string.IsNullOrWhiteSpace(body.Cadence))
        {
            return ErrorEnvelope(StatusCodes.Status400BadRequest,
                "invalid_cadence", "Cadence must be 'monthly' or 'annual'.");
        }
        var cadence = body.Cadence.Trim().ToLowerInvariant();
        if (cadence != "monthly" && cadence != "annual")
        {
            return ErrorEnvelope(StatusCodes.Status400BadRequest,
                "invalid_cadence", "Cadence must be 'monthly' or 'annual'.");
        }

        if (!opts.IsConfigured)
        {
            // Dev runs without Stripe creds — surface the state so the
            // frontend can render a friendly message instead of hanging.
            return ErrorEnvelope(StatusCodes.Status503ServiceUnavailable,
                "stripe_not_configured",
                "Stripe is not configured in this environment.");
        }

        var priceId = cadence == "monthly" ? opts.PriceProMonthly! : opts.PriceProAnnual!;

        // Fetch or create the Stripe customer. The first checkout for a user
        // creates the customer; subsequent checkouts reuse the stored id so
        // we don't proliferate Stripe customers per user.
        var user = await db.Users
            .FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null) return Results.NotFound();

        if (string.IsNullOrEmpty(user.StripeCustomerId))
        {
            var customer = await stripeClient.CreateCustomerAsync(
                new CustomerCreateOptions
                {
                    Email = user.Email,
                    Metadata = new Dictionary<string, string>
                    {
                        ["spectr_user_id"] = userId.ToString(),
                    },
                },
                ct);
            user.StripeCustomerId = customer.Id;
            await db.SaveChangesAsync(ct);
        }

        var session = await stripeClient.CreateCheckoutSessionAsync(
            new SessionCreateOptions
            {
                Mode = "subscription",
                Customer = user.StripeCustomerId,
                ClientReferenceId = userId.ToString(),
                LineItems = new List<SessionLineItemOptions>
                {
                    new() { Price = priceId, Quantity = 1 },
                },
                AutomaticTax = new SessionAutomaticTaxOptions { Enabled = true },
                SuccessUrl = opts.SuccessUrl,
                CancelUrl = opts.CancelUrl,
                AllowPromotionCodes = false,
                BillingAddressCollection = "auto",
                // Stripe also propagates this onto the Subscription so the
                // webhook's metadata lookup wins regardless of customer-id
                // race.
                SubscriptionData = new SessionSubscriptionDataOptions
                {
                    Metadata = new Dictionary<string, string>
                    {
                        ["spectr_user_id"] = userId.ToString(),
                    },
                },
            },
            ct);

        return Results.Ok(new CreateCheckoutSessionResponse(
            Url: session.Url, SessionId: session.Id));
    }

    // ── POST /stripe/webhook ────────────────────────────────────────────────

    private static async Task<IResult> PostStripeWebhook(
        HttpContext httpCtx,
        AppDbContext db,
        IOptions<StripeOptions> stripeOpts,
        SubscriptionMirrorService mirrorService,
        ILogger<StripeWebhookLogScope> logger,
        CancellationToken ct)
    {
        var opts = stripeOpts.Value;

        if (string.IsNullOrWhiteSpace(opts.WebhookSecret))
        {
            // Don't accept webhooks in an unconfigured environment — would
            // otherwise log noisy unverified payloads.
            return ErrorEnvelope(StatusCodes.Status503ServiceUnavailable,
                "stripe_not_configured",
                "Stripe webhook secret is not configured.");
        }

        // Read the raw body verbatim. Signature is computed over the
        // unparsed bytes — even a whitespace change breaks verification.
        httpCtx.Request.EnableBuffering();
        string rawBody;
        using (var reader = new StreamReader(
            httpCtx.Request.Body, Encoding.UTF8, leaveOpen: true))
        {
            rawBody = await reader.ReadToEndAsync(ct);
            httpCtx.Request.Body.Position = 0;
        }

        var signatureHeader = httpCtx.Request.Headers["Stripe-Signature"].ToString();
        if (string.IsNullOrEmpty(signatureHeader))
        {
            return ErrorEnvelope(StatusCodes.Status400BadRequest,
                "webhook_signature_invalid",
                "Stripe-Signature header missing.");
        }

        Event stripeEvent;
        try
        {
            stripeEvent = EventUtility.ConstructEvent(
                rawBody, signatureHeader, opts.WebhookSecret,
                throwOnApiVersionMismatch: false);
        }
        catch (StripeException ex)
        {
            // Log the LAST 4 of the secret only — full secret would be a
            // disclosure risk in shared logs.
            var tail = opts.WebhookSecret.Length >= 4
                ? opts.WebhookSecret[^4..]
                : "****";
            logger.LogWarning(ex,
                "Stripe webhook signature verification failed (secret tail ****{Tail})",
                tail);
            return ErrorEnvelope(StatusCodes.Status400BadRequest,
                "webhook_signature_invalid",
                "Webhook signature verification failed.");
        }

        // AR11 idempotency — insert-or-skip on the Stripe event.id PK.
        var payloadHash = ComputeSha256Hex(rawBody);
        var inserted = await db.Database.ExecuteSqlInterpolatedAsync(
            $@"INSERT INTO webhook_events (id, event_type, payload_hash, received_at)
                VALUES ({stripeEvent.Id}, {stripeEvent.Type}, {payloadHash}, now())
                ON CONFLICT (id) DO NOTHING",
            ct);
        if (inserted == 0)
        {
            // Duplicate delivery — Stripe retried; we've already processed.
            return Results.Ok(new { duplicate = true });
        }

        if (!SupportedSubscriptionEvents.Contains(stripeEvent.Type))
        {
            logger.LogInformation(
                "Ignoring unsupported Stripe event type {Type} (id={Id})",
                stripeEvent.Type, stripeEvent.Id);
            // We persisted the row; leave processed_at NULL so the audit
            // log shows we saw + ignored. Story 2.3 / 2.4 will widen the
            // supported set.
            return Results.Ok(new { ignored = true });
        }

        try
        {
            await DispatchAsync(stripeEvent, mirrorService, ct);
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"UPDATE webhook_events SET processed_at = now() WHERE id = {stripeEvent.Id}",
                ct);
            return Results.Ok(new { processed = true });
        }
        catch (Exception ex)
        {
            logger.LogError(ex,
                "Stripe webhook dispatch failed — event type {Type}, id {Id}",
                stripeEvent.Type, stripeEvent.Id);
            await db.Database.ExecuteSqlInterpolatedAsync(
                $@"UPDATE webhook_events SET processing_error = {ex.Message}
                    WHERE id = {stripeEvent.Id}",
                ct);
            // Re-throw so Stripe sees a 5xx and retries via its dashboard.
            throw;
        }
    }

    private static async Task DispatchAsync(
        Event stripeEvent,
        SubscriptionMirrorService mirrorService,
        CancellationToken ct)
    {
        switch (stripeEvent.Type)
        {
            case "checkout.session.completed":
            {
                // The session payload references a subscription id; we
                // wait for the customer.subscription.created event for the
                // actual mirror write. Some merchants apply ancillary
                // state here; we don't have any in 2.1.
                return;
            }
            case "customer.subscription.created":
            case "customer.subscription.updated":
            case "customer.subscription.deleted":
            {
                if (stripeEvent.Data.Object is Stripe.Subscription stripeSub)
                {
                    await mirrorService.ApplyAsync(stripeSub, ct);
                }
                return;
            }
            case "invoice.paid":
            case "invoice.payment_failed":
            {
                // Story 2.9 owns dunning UX state. For 2.1 we acknowledge
                // these events but take no action — the underlying
                // subscription status change will arrive as a
                // customer.subscription.updated event anyway.
                return;
            }
            default:
                // Filtered upstream by SupportedSubscriptionEvents — this
                // branch is unreachable but keeps the switch exhaustive.
                return;
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private static IResult ErrorEnvelope(
        int status, string code, string message, object? details = null)
    {
        return Results.Json(
            new { error = new { code, message, details } },
            statusCode: status);
    }

    private static string ComputeSha256Hex(string s)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(s));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    // Marker so we can scope an ILogger<T> without exposing the full
    // class name in log output.
    internal sealed class StripeWebhookLogScope { }
}
