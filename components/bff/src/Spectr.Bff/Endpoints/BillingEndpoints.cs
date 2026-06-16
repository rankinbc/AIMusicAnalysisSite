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

        // Story 2.2 — manage-subscription self-service.
        billing.MapGet("/me", GetBillingSummary).RequireAuthorization();
        billing.MapPost("/cancel", PostCancel).RequireAuthorization();
        billing.MapPost("/resubscribe", PostResubscribe).RequireAuthorization();
        billing.MapPost("/change-cadence", PostChangeCadence).RequireAuthorization();
        billing.MapPost("/portal", PostPortal).RequireAuthorization();

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
            return ErrorEnvelope.Build(StatusCodes.Status400BadRequest,
                "invalid_cadence", "Cadence must be 'monthly' or 'annual'.");
        }
        var cadence = body.Cadence.Trim().ToLowerInvariant();
        if (cadence != "monthly" && cadence != "annual")
        {
            return ErrorEnvelope.Build(StatusCodes.Status400BadRequest,
                "invalid_cadence", "Cadence must be 'monthly' or 'annual'.");
        }

        if (!opts.IsConfigured)
        {
            // Dev runs without Stripe creds — surface the state so the
            // frontend can render a friendly message instead of hanging.
            return ErrorEnvelope.Build(StatusCodes.Status503ServiceUnavailable,
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
            // review-fix P1 — idempotency key on the Stripe call. A
            // user-stable key (one customer per user, ever) makes any retry
            // of this exact request a no-op on Stripe's side. They'll
            // return the same `cus_...` id.
            var customerIdempotencyKey = $"customer:{userId:N}";
            var customer = await stripeClient.CreateCustomerAsync(
                new CustomerCreateOptions
                {
                    Email = user.Email,
                    Metadata = new Dictionary<string, string>
                    {
                        ["spectr_user_id"] = userId.ToString(),
                    },
                },
                customerIdempotencyKey,
                ct);

            // review-fix P2 — TOCTOU-safe write. Two concurrent checkout
            // POSTs from the same user could both read `StripeCustomerId
            // == null`; without this guard both would create separate
            // Stripe customers and the second SaveChanges would 500 on
            // the partial-where unique index. An UPDATE … WHERE
            // stripe_customer_id IS NULL is atomic; the loser falls
            // through to re-read the winner's customer id and abandons
            // its own (Stripe's idempotency key makes this safe — the
            // loser's call returned the SAME customer id as the winner's
            // since both passed `customer:<userId>` as the key).
            var rows = await db.Users
                .Where(u => u.Id == userId && u.StripeCustomerId == null)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(
                        u => u.StripeCustomerId, customer.Id),
                    ct);
            if (rows == 0)
            {
                // Loser of the race — winner's customer id is already
                // persisted. Re-read so the session uses the canonical id.
                user.StripeCustomerId = await db.Users
                    .AsNoTracking()
                    .Where(u => u.Id == userId)
                    .Select(u => u.StripeCustomerId)
                    .FirstAsync(ct);
            }
            else
            {
                user.StripeCustomerId = customer.Id;
            }
        }

        // review-fix P1 — idempotency key on session creation too. A
        // user+cadence-stable key means a retry returns the SAME session
        // URL; the user gets one checkout, not two. Salting with
        // `priceId` lets a user start monthly, cancel, then start annual
        // without colliding.
        var sessionIdempotencyKey = $"session:{userId:N}:{priceId}";
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
            sessionIdempotencyKey,
            ct);

        return Results.Ok(new CreateCheckoutSessionResponse(
            Url: session.Url, SessionId: session.Id));
    }

    // ── Story 2.2: manage-subscription endpoints ────────────────────────────

    private static async Task<IResult> GetBillingSummary(
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IOptions<StripeOptions> stripeOpts,
        IOptions<PricingDisplayOptions> pricingOpts,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var sub = await db.Subscriptions.AsNoTracking()
            .FirstOrDefaultAsync(s => s.UserId == userId, ct);
        if (sub is null)
        {
            return Results.Ok(new BillingSummaryDto(
                Tier: "free", Status: null, Cadence: null, PriceId: null,
                CurrentPeriodEnd: null, CancelAt: null,
                CancelAtPeriodEnd: false,
                NextChargeAt: null, NextChargeCents: null, Currency: null));
        }

        var cadence = ResolveCadence(sub.PriceId, stripeOpts.Value);
        var tier = AuthEndpoints.ResolveTier(sub.Status);
        var cancelAtPeriodEnd = sub.CancelAt is not null;
        var pricing = pricingOpts.Value;
        int? nextChargeCents = cadence switch
        {
            "monthly" => pricing.ProMonthlyCents,
            "annual" => pricing.ProAnnualCents,
            _ => null,
        };

        return Results.Ok(new BillingSummaryDto(
            Tier: tier,
            Status: sub.Status,
            Cadence: cadence,
            PriceId: sub.PriceId,
            CurrentPeriodEnd: sub.CurrentPeriodEnd,
            CancelAt: sub.CancelAt,
            CancelAtPeriodEnd: cancelAtPeriodEnd,
            NextChargeAt: cancelAtPeriodEnd ? null : sub.CurrentPeriodEnd,
            NextChargeCents: cancelAtPeriodEnd ? null : nextChargeCents,
            Currency: pricing.Currency));
    }

    private static async Task<IResult> PostCancel(
        CancelSubscriptionRequest body,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IOptions<StripeOptions> stripeOpts,
        IOptions<PricingDisplayOptions> pricingOpts,
        IStripeSubscriptionClient stripeSubs,
        CancellationToken ct)
    {
        var opts = stripeOpts.Value;
        if (!opts.IsConfigured)
        {
            return ErrorEnvelope.Build(StatusCodes.Status503ServiceUnavailable,
                "stripe_not_configured",
                "Stripe is not configured in this environment.");
        }

        var userId = currentUser.UserId();
        var sub = await db.Subscriptions
            .FirstOrDefaultAsync(s => s.UserId == userId, ct);
        if (sub is null
            || (sub.Status != "active" && sub.Status != "trialing" && sub.Status != "past_due"))
        {
            return ErrorEnvelope.Build(StatusCodes.Status409Conflict,
                "no_active_subscription",
                "You don't have an active subscription to cancel.");
        }

        // Idempotency key salted with current period so a new period
        // (post-renewal) gets a fresh key; retries within the period
        // collapse on Stripe's side.
        var idempotencyKey =
            $"cancel:{userId:N}:{sub.CurrentPeriodEnd.ToUnixTimeSeconds()}";
        var metadata = new Dictionary<string, string>();
        if (!string.IsNullOrWhiteSpace(body?.Reason))
        {
            metadata["cancel_reason"] = body.Reason!.Trim();
        }
        await stripeSubs.UpdateAsync(
            sub.StripeSubscriptionId,
            new SubscriptionUpdateOptions
            {
                CancelAtPeriodEnd = true,
                Metadata = metadata.Count > 0 ? metadata : null,
            },
            idempotencyKey,
            ct);

        // Apply the local mirror change optimistically so the response
        // reflects the new state without waiting for the webhook. The
        // webhook will reconcile via the existing SubscriptionMirrorService.
        sub.CancelAt = sub.CurrentPeriodEnd;
        sub.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);

        return await GetBillingSummary(currentUser, db, stripeOpts, pricingOpts, ct);
    }

    private static async Task<IResult> PostResubscribe(
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IOptions<StripeOptions> stripeOpts,
        IOptions<PricingDisplayOptions> pricingOpts,
        IStripeSubscriptionClient stripeSubs,
        CancellationToken ct)
    {
        if (!stripeOpts.Value.IsConfigured)
        {
            return ErrorEnvelope.Build(StatusCodes.Status503ServiceUnavailable,
                "stripe_not_configured",
                "Stripe is not configured in this environment.");
        }

        var userId = currentUser.UserId();
        var sub = await db.Subscriptions
            .FirstOrDefaultAsync(s => s.UserId == userId, ct);
        if (sub is null || sub.CancelAt is null)
        {
            return ErrorEnvelope.Build(StatusCodes.Status409Conflict,
                "not_pending_cancel",
                "There's no pending cancellation to reverse.");
        }

        var idempotencyKey =
            $"resubscribe:{userId:N}:{sub.CurrentPeriodEnd.ToUnixTimeSeconds()}";
        await stripeSubs.UpdateAsync(
            sub.StripeSubscriptionId,
            new SubscriptionUpdateOptions { CancelAtPeriodEnd = false },
            idempotencyKey,
            ct);

        sub.CancelAt = null;
        sub.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);

        return await GetBillingSummary(currentUser, db, stripeOpts, pricingOpts, ct);
    }

    private static async Task<IResult> PostChangeCadence(
        ChangeCadenceRequest body,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IOptions<StripeOptions> stripeOpts,
        IOptions<PricingDisplayOptions> pricingOpts,
        IStripeSubscriptionClient stripeSubs,
        CancellationToken ct)
    {
        var opts = stripeOpts.Value;
        if (!opts.IsConfigured)
        {
            return ErrorEnvelope.Build(StatusCodes.Status503ServiceUnavailable,
                "stripe_not_configured",
                "Stripe is not configured in this environment.");
        }
        if (body is null || string.IsNullOrWhiteSpace(body.Cadence))
        {
            return ErrorEnvelope.Build(StatusCodes.Status400BadRequest,
                "invalid_cadence", "Cadence must be 'monthly' or 'annual'.");
        }
        var cadence = body.Cadence.Trim().ToLowerInvariant();
        if (cadence != "monthly" && cadence != "annual")
        {
            return ErrorEnvelope.Build(StatusCodes.Status400BadRequest,
                "invalid_cadence", "Cadence must be 'monthly' or 'annual'.");
        }

        var userId = currentUser.UserId();
        var sub = await db.Subscriptions
            .FirstOrDefaultAsync(s => s.UserId == userId, ct);
        if (sub is null
            || (sub.Status != "active" && sub.Status != "trialing"))
        {
            return ErrorEnvelope.Build(StatusCodes.Status409Conflict,
                "no_active_subscription",
                "You don't have an active subscription to modify.");
        }

        var currentCadence = ResolveCadence(sub.PriceId, opts);
        if (currentCadence == cadence)
        {
            return ErrorEnvelope.Build(StatusCodes.Status409Conflict,
                "same_cadence",
                $"You're already on the {cadence} plan.");
        }
        if (string.IsNullOrEmpty(sub.StripeItemId))
        {
            // Story 2.2 / Task 6.2 — backfill happens on next webhook.
            // Until that arrives, the change-cadence endpoint can't
            // operate on this row (Stripe needs the item id).
            return ErrorEnvelope.Build(StatusCodes.Status409Conflict,
                "subscription_not_ready",
                "Your subscription is still syncing. Please retry in a minute.");
        }

        var newPriceId = cadence == "monthly"
            ? opts.PriceProMonthly!
            : opts.PriceProAnnual!;
        var idempotencyKey = $"cadence:{userId:N}:{newPriceId}";
        await stripeSubs.UpdateAsync(
            sub.StripeSubscriptionId,
            new SubscriptionUpdateOptions
            {
                Items = new List<SubscriptionItemOptions>
                {
                    new()
                    {
                        Id = sub.StripeItemId,
                        Price = newPriceId,
                    },
                },
                ProrationBehavior = "create_prorations",
            },
            idempotencyKey,
            ct);

        // Optimistic mirror: reflect the new price id immediately. The
        // webhook will reconcile the full subscription state (period_end,
        // etc.) when it arrives.
        sub.PriceId = newPriceId;
        sub.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);

        return await GetBillingSummary(currentUser, db, stripeOpts, pricingOpts, ct);
    }

    private static async Task<IResult> PostPortal(
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IOptions<StripeOptions> stripeOpts,
        IStripeSubscriptionClient stripeSubs,
        CancellationToken ct)
    {
        if (!stripeOpts.Value.IsConfigured)
        {
            return ErrorEnvelope.Build(StatusCodes.Status503ServiceUnavailable,
                "stripe_not_configured",
                "Stripe is not configured in this environment.");
        }

        var userId = currentUser.UserId();
        var user = await db.Users.AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null || string.IsNullOrEmpty(user.StripeCustomerId))
        {
            return ErrorEnvelope.Build(StatusCodes.Status409Conflict,
                "no_stripe_customer",
                "You need to start a subscription before opening the billing portal.");
        }

        var portalReturnUrl = stripeOpts.Value.SuccessUrl.Replace(
            "?session_id={CHECKOUT_SESSION_ID}", string.Empty,
            StringComparison.Ordinal);
        var dayBucket = DateTimeOffset.UtcNow.Date.ToString("yyyyMMdd");
        var idempotencyKey = $"portal:{userId:N}:{dayBucket}";
        var session = await stripeSubs.CreatePortalSessionAsync(
            new Stripe.BillingPortal.SessionCreateOptions
            {
                Customer = user.StripeCustomerId,
                ReturnUrl = portalReturnUrl,
            },
            idempotencyKey,
            ct);

        return Results.Ok(new CreatePortalSessionResponse(session.Url));
    }

    // Cadence resolution from a Stripe price id (small in-memory map; the
    // four-way lookup is hot-path).
    private static string ResolveCadence(string priceId, StripeOptions opts)
    {
        if (string.Equals(priceId, opts.PriceProMonthly, StringComparison.Ordinal))
            return "monthly";
        if (string.Equals(priceId, opts.PriceProAnnual, StringComparison.Ordinal))
            return "annual";
        return "unknown";
    }

    // ── POST /stripe/webhook ────────────────────────────────────────────────

    private static async Task<IResult> PostStripeWebhook(
        HttpContext httpCtx,
        AppDbContext db,
        IOptions<StripeOptions> stripeOpts,
        SubscriptionMirrorService mirrorService,
        // review-fix P17 — log category is the public marker
        // `Spectr.Bff.Endpoints.BillingWebhook`. Static classes can't be
        // ILogger<T> targets, so we use a small concrete marker type
        // declared below. Cleaner than the prior nested-type name in log
        // filters; DI resolves ILogger<T> for any concrete T.
        ILogger<BillingWebhook> logger,
        CancellationToken ct)
    {
        var opts = stripeOpts.Value;

        if (string.IsNullOrWhiteSpace(opts.WebhookSecret))
        {
            // Don't accept webhooks in an unconfigured environment — would
            // otherwise log noisy unverified payloads.
            return ErrorEnvelope.Build(StatusCodes.Status503ServiceUnavailable,
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
            return ErrorEnvelope.Build(StatusCodes.Status400BadRequest,
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
            return ErrorEnvelope.Build(StatusCodes.Status400BadRequest,
                "webhook_signature_invalid",
                "Webhook signature verification failed.");
        }

        // AR11 idempotency — insert-or-skip on the Stripe event.id PK.
        // review-fix P3 — the duplicate skip MUST be conditional on a
        // previous SUCCESSFUL processing (processed_at IS NOT NULL).
        // The prior version skipped on row existence alone, so a row
        // inserted by a failed-then-retried delivery would forever-after
        // tell Stripe `{ duplicate: true }` and never re-process. The
        // RETURNING clause + a fall-through reads the row to decide.
        var payloadHash = ComputeSha256Hex(rawBody);
        var inserted = await db.Database.ExecuteSqlInterpolatedAsync(
            $@"INSERT INTO webhook_events (id, event_type, payload_hash, received_at)
                VALUES ({stripeEvent.Id}, {stripeEvent.Type}, {payloadHash}, now())
                ON CONFLICT (id) DO NOTHING",
            ct);
        if (inserted == 0)
        {
            // Row already exists. Check if it was successfully processed —
            // if so, this is a Stripe retry of a completed event and we
            // safely skip. If processed_at IS NULL, the prior dispatch
            // failed and we must let this retry proceed to dispatch.
            var prev = await db.WebhookEvents
                .AsNoTracking()
                .Where(w => w.Id == stripeEvent.Id)
                .Select(w => w.ProcessedAt)
                .FirstOrDefaultAsync(ct);
            if (prev is not null)
            {
                return Results.Ok(new { duplicate = true });
            }
            // Fall through — re-dispatch the previously-failed event.
            // The processing_error column will be overwritten if it
            // fails again, or cleared on success below.
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
            // review-fix P3 — also clear processing_error on success so
            // a previously-failed event that succeeds on retry leaves
            // no stale error trail.
            await db.Database.ExecuteSqlInterpolatedAsync(
                $@"UPDATE webhook_events
                    SET processed_at = now(), processing_error = NULL
                    WHERE id = {stripeEvent.Id}",
                ct);
            return Results.Ok(new { processed = true });
        }
        catch (Exception ex)
        {
            logger.LogError(ex,
                "Stripe webhook dispatch failed — event type {Type}, id {Id}",
                stripeEvent.Type, stripeEvent.Id);
            // review-fix P16 — PII hygiene. Stripe SDK exceptions can
            // include customer email / billing address / decline reason
            // text. The webhook_events table is supposed to stay
            // payload-hash-only (no PII). Strip to the exception type +
            // first-line and truncate hard to a small safe length so a
            // future log analyser sees enough to triage but the table
            // never accumulates PII.
            var safeError = SanitizeProcessingError(ex);
            await db.Database.ExecuteSqlInterpolatedAsync(
                $@"UPDATE webhook_events SET processing_error = {safeError}
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

    // review-fix P10 — uses the shared Endpoints.ErrorEnvelope helper.

    private static string ComputeSha256Hex(string s)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(s));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    // review-fix P16 — strip PII from exception messages before persisting
    // them on webhook_events.processing_error. Keeps the exception type
    // name + a hard-truncated first-line so ops can triage without
    // accumulating customer emails / billing addresses / card-decline
    // reasons in what should be a payload-hash-only audit table.
    // review-fix P17 — concrete marker for ILogger<T> category. Logs
    // surface as `Spectr.Bff.Endpoints.BillingWebhook` in filters.
    public sealed class BillingWebhook { }

    private const int ProcessingErrorMaxLength = 200;
    private static string SanitizeProcessingError(Exception ex)
    {
        var typeName = ex.GetType().Name;
        var firstLine = (ex.Message ?? string.Empty)
            .Split('\n', 2)[0]
            .Trim();
        if (firstLine.Length > ProcessingErrorMaxLength)
        {
            firstLine = firstLine[..ProcessingErrorMaxLength];
        }
        return string.IsNullOrEmpty(firstLine)
            ? typeName
            : $"{typeName}: {firstLine}";
    }
}
