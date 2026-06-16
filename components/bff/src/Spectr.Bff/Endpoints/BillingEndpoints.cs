using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
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

        // Story 2.3 — credit pack purchase + ledger read.
        billing.MapPost("/checkout/credits", PostCheckoutCredits).RequireAuthorization();
        billing.MapGet("/credits", GetCredits).RequireAuthorization();

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
            CreditPack5Cents: o.CreditPack5Cents,
            CreditPack10Cents: o.CreditPack10Cents,
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
    //
    // Architecture D2 / Story 2.2 review-fix P1 — every mutation endpoint
    // here CALLS Stripe (which is canonical), then projects the post-call
    // state into a BillingSummaryDto WITHOUT persisting to the local
    // mirror. The webhook processor + SubscriptionMirrorService is the
    // ONLY canonical writer to the `subscriptions` table. The response
    // body is the immediate post-mutation view for the frontend; the
    // mirror catches up via the inevitable `customer.subscription.updated`
    // event Stripe dispatches as a side effect of every UpdateAsync.

    private static async Task<IResult> GetBillingSummary(
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IOptions<StripeOptions> stripeOpts,
        IOptions<PricingDisplayOptions> pricingOpts,
        ILogger<BillingWebhook> logger,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var sub = await db.Subscriptions.AsNoTracking()
            .FirstOrDefaultAsync(s => s.UserId == userId, ct);
        if (sub is null)
        {
            return Results.Ok(FreeSummary());
        }

        return Results.Ok(BuildSummary(
            status: sub.Status,
            priceId: sub.PriceId,
            currentPeriodEnd: sub.CurrentPeriodEnd,
            cancelAt: sub.CancelAt,
            stripeOpts: stripeOpts.Value,
            pricingOpts: pricingOpts.Value,
            logger: logger));
    }

    private static async Task<IResult> PostCancel(
        CancelSubscriptionRequest body,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IOptions<StripeOptions> stripeOpts,
        IOptions<PricingDisplayOptions> pricingOpts,
        IStripeSubscriptionClient stripeSubs,
        ILogger<BillingWebhook> logger,
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
        var sub = await db.Subscriptions.AsNoTracking()
            .FirstOrDefaultAsync(s => s.UserId == userId, ct);
        if (sub is null
            || (sub.Status != "active" && sub.Status != "trialing" && sub.Status != "past_due"))
        {
            return ErrorEnvelope.Build(StatusCodes.Status409Conflict,
                "no_active_subscription",
                "You don't have an active subscription to cancel.");
        }

        // Story 2.2 review-fix P7 — double-cancel guard. A user already
        // pending cancel calling /cancel again would otherwise re-hit
        // Stripe (collapsed on the idempotency key) for no behavior
        // change. Surface a clean 409 instead so the frontend can
        // refresh state and the BFF avoids the wasted roundtrip.
        if (sub.CancelAt is not null)
        {
            return ErrorEnvelope.Build(StatusCodes.Status409Conflict,
                "already_canceling",
                "This subscription is already scheduled to cancel.");
        }

        // Story 2.2 review-fix P3 — idempotency keys are salted with the
        // stable `StripeSubscriptionId` rather than `CurrentPeriodEnd`.
        // The mirror's period_end can fall back to a UtcNow-derived
        // sentinel (story 2.1 review-fix P20) when the payload is
        // missing the field, which would produce a different unix
        // timestamp on each pod and defeat idempotency.
        var idempotencyKey = $"cancel:{userId:N}:{sub.StripeSubscriptionId}";

        // Story 2.2 review-fix P4 / D3 — always include the
        // `cancel_reason` key (per spec text `reason ?? ""`). Passing
        // null Metadata to Stripe clears ALL existing metadata; always
        // including the key keeps analytics consistent and never wipes
        // other Stripe-side metadata.
        var reason = body?.Reason?.Trim() ?? string.Empty;
        await stripeSubs.UpdateAsync(
            sub.StripeSubscriptionId,
            new SubscriptionUpdateOptions
            {
                CancelAtPeriodEnd = true,
                Metadata = new Dictionary<string, string>
                {
                    ["cancel_reason"] = reason,
                },
            },
            idempotencyKey,
            ct);

        // Architecture D2: do NOT write the mirror here. The webhook
        // reconciles the canonical state. Project the post-Stripe view
        // for the immediate response.
        return Results.Ok(BuildSummary(
            status: sub.Status,
            priceId: sub.PriceId,
            currentPeriodEnd: sub.CurrentPeriodEnd,
            cancelAt: sub.CurrentPeriodEnd,
            stripeOpts: opts,
            pricingOpts: pricingOpts.Value,
            logger: logger));
    }

    private static async Task<IResult> PostResubscribe(
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IOptions<StripeOptions> stripeOpts,
        IOptions<PricingDisplayOptions> pricingOpts,
        IStripeSubscriptionClient stripeSubs,
        ILogger<BillingWebhook> logger,
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
        var sub = await db.Subscriptions.AsNoTracking()
            .FirstOrDefaultAsync(s => s.UserId == userId, ct);
        if (sub is null || sub.CancelAt is null)
        {
            return ErrorEnvelope.Build(StatusCodes.Status409Conflict,
                "not_pending_cancel",
                "There's no pending cancellation to reverse.");
        }
        // Story 2.2 review-fix P6 — guard against a terminated sub.
        // Once Stripe transitions status to `canceled` (post-period-end),
        // Update returns a 400-class error that would surface as a 500.
        // Reject up front with a clean 409.
        if (sub.Status != "active" && sub.Status != "trialing" && sub.Status != "past_due")
        {
            return ErrorEnvelope.Build(StatusCodes.Status409Conflict,
                "no_active_subscription",
                "This subscription has ended; start a new one from the pricing page.");
        }

        var idempotencyKey = $"resubscribe:{userId:N}:{sub.StripeSubscriptionId}";

        // Story 2.2 review-fix P5 — explicit empty metadata key so we
        // don't accidentally clear other Stripe-side metadata. We also
        // clear the cancel_reason since resubscribing reverses the
        // intent (story 2.10 reconciliation can see the empty string
        // and treat it as "user reactivated").
        await stripeSubs.UpdateAsync(
            sub.StripeSubscriptionId,
            new SubscriptionUpdateOptions
            {
                CancelAtPeriodEnd = false,
                Metadata = new Dictionary<string, string>
                {
                    ["cancel_reason"] = string.Empty,
                },
            },
            idempotencyKey,
            ct);

        return Results.Ok(BuildSummary(
            status: sub.Status,
            priceId: sub.PriceId,
            currentPeriodEnd: sub.CurrentPeriodEnd,
            cancelAt: null,
            stripeOpts: opts,
            pricingOpts: pricingOpts.Value,
            logger: logger));
    }

    private static async Task<IResult> PostChangeCadence(
        ChangeCadenceRequest body,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IOptions<StripeOptions> stripeOpts,
        IOptions<PricingDisplayOptions> pricingOpts,
        IStripeSubscriptionClient stripeSubs,
        ILogger<BillingWebhook> logger,
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

        // Story 2.2 review-fix P23 — defensive null-check on the price
        // options before the null-bang dereference below. IsConfigured
        // already guarantees both are non-empty, but make the dependency
        // explicit so a future loosening of IsConfigured doesn't NRE here.
        if (string.IsNullOrWhiteSpace(opts.PriceProMonthly)
            || string.IsNullOrWhiteSpace(opts.PriceProAnnual))
        {
            return ErrorEnvelope.Build(StatusCodes.Status503ServiceUnavailable,
                "stripe_not_configured",
                "Stripe price ids are not configured.");
        }

        var userId = currentUser.UserId();
        var sub = await db.Subscriptions.AsNoTracking()
            .FirstOrDefaultAsync(s => s.UserId == userId, ct);
        if (sub is null
            || (sub.Status != "active" && sub.Status != "trialing"))
        {
            return ErrorEnvelope.Build(StatusCodes.Status409Conflict,
                "no_active_subscription",
                "You don't have an active subscription to modify.");
        }
        // Story 2.2 review-fix P10 — block cadence change while a
        // cancellation is pending. The frontend hides the toggle in
        // this state, but a direct API call would otherwise trigger a
        // real Stripe proration charge on a sub the user is leaving.
        if (sub.CancelAt is not null)
        {
            return ErrorEnvelope.Build(StatusCodes.Status409Conflict,
                "subscription_pending_cancel",
                "Resubscribe before changing cadence.");
        }

        var currentCadence = ResolveCadence(sub.PriceId, opts, logger);
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
            ? opts.PriceProMonthly
            : opts.PriceProAnnual;
        // Story 2.2 review-fix P11 — period-salted so a retry of the
        // same direction within a future billing cycle gets a fresh
        // idempotency key (Stripe caches keys for 24h).
        var idempotencyKey =
            $"cadence:{userId:N}:{sub.StripeSubscriptionId}:{sub.CurrentPeriodEnd.ToUnixTimeSeconds()}:{newPriceId}";
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

        // Architecture D2: no local mirror write — webhook reconciles.
        return Results.Ok(BuildSummary(
            status: sub.Status,
            priceId: newPriceId,
            currentPeriodEnd: sub.CurrentPeriodEnd,
            cancelAt: sub.CancelAt,
            stripeOpts: opts,
            pricingOpts: pricingOpts.Value,
            logger: logger));
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

        // Story 2.2 review-fix P2 — use the dedicated PortalReturnUrl
        // option instead of string-munging SuccessUrl. The prior code
        // produced `/billing/success` (the checkout success route)
        // instead of `/billing` (the self-service page the user came
        // from). Defaults to the dev origin; prod overrides via env.
        var portalReturnUrl = stripeOpts.Value.PortalReturnUrl;
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

    // ── Story 2.2 helpers ───────────────────────────────────────────────────

    // Story 2.2 review-fix P22 — `Currency` is null when there is no
    // upcoming charge (free or canceled state). Matches the frontend
    // type declaration `currency: string | null` and prevents stale
    // currency strings from being read in canceled-state UI.
    private static BillingSummaryDto FreeSummary() => new(
        Tier: "free", Status: null, Cadence: null, PriceId: null,
        CurrentPeriodEnd: null, CancelAt: null,
        CancelAtPeriodEnd: false,
        NextChargeAt: null, NextChargeCents: null, Currency: null);

    // Project a known subscription state into the response DTO. Used by
    // both the read path (GetBillingSummary) and the write paths
    // (Cancel / Resubscribe / ChangeCadence) so the post-mutation
    // response shape is identical to a subsequent GET.
    private static BillingSummaryDto BuildSummary(
        string status,
        string priceId,
        DateTimeOffset currentPeriodEnd,
        DateTimeOffset? cancelAt,
        StripeOptions stripeOpts,
        PricingDisplayOptions pricingOpts,
        ILogger<BillingWebhook> logger)
    {
        var cadence = ResolveCadence(priceId, stripeOpts, logger);
        var tier = AuthEndpoints.ResolveTier(status);
        var cancelAtPeriodEnd = cancelAt is not null;
        int? nextChargeCents = cadence switch
        {
            "monthly" => pricingOpts.ProMonthlyCents,
            "annual" => pricingOpts.ProAnnualCents,
            _ => null,
        };

        return new BillingSummaryDto(
            Tier: tier,
            Status: status,
            Cadence: cadence,
            PriceId: priceId,
            CurrentPeriodEnd: currentPeriodEnd,
            CancelAt: cancelAt,
            CancelAtPeriodEnd: cancelAtPeriodEnd,
            NextChargeAt: cancelAtPeriodEnd ? null : currentPeriodEnd,
            NextChargeCents: cancelAtPeriodEnd ? null : nextChargeCents,
            Currency: cancelAtPeriodEnd ? null : pricingOpts.Currency);
    }

    // Cadence resolution from a Stripe price id. The configured price
    // map is tiny (2 entries) so a comparison is cheaper than a
    // dictionary lookup; the `unknown` branch warns the operator so
    // admin price drift (a price was archived and a new one rotated in)
    // doesn't go silently undetected — story 2.2 / Task 2.2 spec.
    private static string ResolveCadence(
        string priceId, StripeOptions opts, ILogger<BillingWebhook>? logger)
    {
        if (string.Equals(priceId, opts.PriceProMonthly, StringComparison.Ordinal))
            return "monthly";
        if (string.Equals(priceId, opts.PriceProAnnual, StringComparison.Ordinal))
            return "annual";
        // Story 2.2 review-fix P20 — warn on price drift so ops can
        // catch admin-side price rotation that doesn't sync to BFF
        // config. Story 2.10's reconciliation job is the long-term fix.
        logger?.LogWarning(
            "Subscription price id {PriceId} matches neither configured monthly ({Monthly}) nor annual ({Annual}) — cadence unknown",
            priceId, opts.PriceProMonthly, opts.PriceProAnnual);
        return "unknown";
    }

    // ── Story 2.3: credit packs ─────────────────────────────────────────────

    private static async Task<IResult> PostCheckoutCredits(
        BuyCreditsRequest body,
        ClaimsPrincipal currentUser,
        AppDbContext db,
        IOptions<StripeOptions> stripeOpts,
        IStripeCheckoutClient stripeClient,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var opts = stripeOpts.Value;

        if (body is null || (body.PackSize != 5 && body.PackSize != 10))
        {
            return ErrorEnvelope.Build(StatusCodes.Status400BadRequest,
                "invalid_pack_size",
                "Pack size must be 5 or 10.");
        }
        if (!opts.CreditPacksConfigured)
        {
            return ErrorEnvelope.Build(StatusCodes.Status503ServiceUnavailable,
                "stripe_not_configured",
                "Stripe is not configured in this environment.");
        }

        var priceId = body.PackSize == 5
            ? opts.PriceCreditPack5!
            : opts.PriceCreditPack10!;

        // Resolve or create the Stripe customer — same atomic
        // UPDATE-WHERE-NULL pattern as story 2.1's subscription checkout
        // (review-fix P2). The customer is shared between subscription
        // and one-time purchases (Stripe stores both under one cus_*).
        var user = await db.Users
            .FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null) return Results.NotFound();

        if (string.IsNullOrEmpty(user.StripeCustomerId))
        {
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

            var rows = await db.Users
                .Where(u => u.Id == userId && u.StripeCustomerId == null)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(
                        u => u.StripeCustomerId, customer.Id),
                    ct);
            if (rows == 0)
            {
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

        // Review-fix P2-C — hourly bucket instead of daily so the user can
        // buy the same pack size more than once per calendar day. The daily
        // bucket caused Stripe to return a cached completed session on the
        // second same-day same-pack call. The ledger partial-unique index
        // (idempotency_key = "credits_purchase:{stripeEventId}") is the
        // canonical financial guard; this key only dedupes network retries
        // within the same hour window.
        var hourBucket = DateTimeOffset.UtcNow.ToString("yyyyMMddHH");
        var sessionIdempotencyKey =
            $"credits_session:{userId:N}:{body.PackSize}:{hourBucket}";

        var session = await stripeClient.CreateCheckoutSessionAsync(
            new SessionCreateOptions
            {
                Mode = "payment",
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
                // The webhook reads spectr_user_id + pack_size off the
                // PaymentIntent's metadata to record the +N ledger
                // entry — store both at session creation so the
                // webhook never has to look up local state.
                // Review-fix P1-A — metadata must also live on the Session object
        // (SessionCreateOptions.Metadata) so session.Metadata is populated
        // in the checkout.session.completed webhook payload. The webhook
        // handler reads session.Metadata, NOT the nested PaymentIntent
        // metadata. PaymentIntentData.Metadata is kept as a dashboard-visible
        // copy on the PaymentIntent object.
                Metadata = new Dictionary<string, string>
                {
                    ["spectr_user_id"] = userId.ToString(),
                    ["pack_size"] = body.PackSize.ToString(),
                },
                PaymentIntentData = new SessionPaymentIntentDataOptions
                {
                    Metadata = new Dictionary<string, string>
                    {
                        ["spectr_user_id"] = userId.ToString(),
                        ["pack_size"] = body.PackSize.ToString(),
                    },
                },
            },
            sessionIdempotencyKey,
            ct);

        return Results.Ok(new CreateCheckoutSessionResponse(
            Url: session.Url, SessionId: session.Id));
    }

    private static async Task<IResult> GetCredits(
        ClaimsPrincipal currentUser,
        AppDbContext db,
        CreditLedgerService credits,
        [Microsoft.AspNetCore.Mvc.FromQuery] string? cursor,
        CancellationToken ct)
    {
        var userId = currentUser.UserId();
        var balance = await credits.GetBalanceAsync(userId, ct);

        // Review-fix P2-B — compound cursor "(created_at ISO-8601)|(id UUID)"
        // eliminates row loss when multiple entries share the same created_at
        // timestamp (e.g., purchase + spend written within the same Postgres
        // transaction-time tick). A timestamp-only cursor uses strict `<` which
        // silently skips any sibling rows with the exact boundary timestamp.
        DateTimeOffset? cursorTs = null;
        Guid? cursorId = null;
        if (!string.IsNullOrWhiteSpace(cursor))
        {
            var parts = cursor.Split('|');
            if (parts.Length != 2
                || !DateTimeOffset.TryParse(
                    parts[0], System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.RoundtripKind,
                    out var parsedTs)
                || !Guid.TryParse(parts[1], out var parsedId))
            {
                return ErrorEnvelope.Build(StatusCodes.Status400BadRequest,
                    "invalid_cursor",
                    "Cursor must be in the format 'timestamp|id'.");
            }
            cursorTs = parsedTs;
            cursorId = parsedId;
        }

        const int PageSize = 50;
        var query = db.CreditLedger.AsNoTracking()
            .Where(e => e.UserId == userId);
        if (cursorTs is not null && cursorId is not null)
        {
            // Keyset: rows that appear AFTER the cursor row in the
            // (created_at DESC, id DESC) sort order.
            var cTs = cursorTs.Value;
            var cId = cursorId.Value;
            query = query.Where(e =>
                e.CreatedAt < cTs || (e.CreatedAt == cTs && e.Id < cId));
        }
        var rows = await query
            .OrderByDescending(e => e.CreatedAt)
            .ThenByDescending(e => e.Id)
            .Take(PageSize + 1)
            .Select(e => new CreditLedgerEntryDto(
                e.Id, e.Amount, e.Reason, e.Reference, e.CreatedAt))
            .ToListAsync(ct);

        string? nextCursor = null;
        if (rows.Count > PageSize)
        {
            // Cursor from the last RETURNED row — the keyset filter
            // uses strict inequality so this row is excluded from the
            // next page, and rows sharing its timestamp but with smaller
            // IDs are correctly included.
            var last = rows[PageSize - 1];
            nextCursor =
                $"{last.CreatedAt.ToString("o", System.Globalization.CultureInfo.InvariantCulture)}|{last.Id}";
            rows = rows.Take(PageSize).ToList();
        }

        return Results.Ok(new CreditsResponse(
            Balance: balance, Entries: rows, NextCursor: nextCursor));
    }

    // ── POST /stripe/webhook ────────────────────────────────────────────────

    private static async Task<IResult> PostStripeWebhook(
        HttpContext httpCtx,
        AppDbContext db,
        IOptions<StripeOptions> stripeOpts,
        SubscriptionMirrorService mirrorService,
        // Story 2.3 — credit-pack purchases land on
        // checkout.session.completed with Mode=="payment".
        CreditLedgerService credits,
        // Story 2.4 — subscription events invalidate the per-user entitlement cache.
        IMemoryCache cache,
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
            await DispatchAsync(stripeEvent, mirrorService, credits, cache, logger, ct);
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
        CreditLedgerService credits,
        IMemoryCache cache,
        ILogger<BillingWebhook> logger,
        CancellationToken ct)
    {
        switch (stripeEvent.Type)
        {
            case "checkout.session.completed":
            {
                // Story 2.3 — credit-pack purchase delivery. The session
                // is in mode="payment" with a PaymentIntent attached;
                // metadata carries spectr_user_id + pack_size.
                // Subscription sessions (mode="subscription") fall
                // through to the no-op tail of this branch — the
                // mirror write happens on customer.subscription.created.
                if (stripeEvent.Data.Object is Stripe.Checkout.Session session
                    && string.Equals(session.Mode, "payment", StringComparison.Ordinal))
                {
                    if (!TryReadUserMetadata(session.Metadata, out var userId)
                        || !session.Metadata.TryGetValue("pack_size", out var packStr)
                        || !int.TryParse(packStr, out var packSize)
                        || packSize <= 0)
                    {
                        // Review-fix P1-B — throw (not return) so the outer
                        // handler writes processing_error + returns 5xx to Stripe
                        // for retry. A silent return would mark processed_at = now()
                        // and Stripe would never retry — the purchase credit would
                        // be permanently lost.
                        throw new InvalidOperationException(
                            $"Credit purchase webhook is missing required metadata on session {session.Id}.");
                    }

                    if (string.IsNullOrEmpty(session.PaymentIntentId))
                    {
                        throw new InvalidOperationException(
                            $"Credit purchase webhook has no PaymentIntent on session {session.Id} — cannot record the purchase.");
                    }

                    // Defense-in-depth on top of AR11 webhook_events
                    // dedupe — partial unique index on the ledger
                    // catches duplicates even if the webhook layer
                    // somehow misses.
                    await credits.PurchaseAsync(
                        userId,
                        packSize,
                        session.PaymentIntentId,
                        idempotencyKey: $"credits_purchase:{stripeEvent.Id}",
                        ct);
                }
                return;
            }
            case "customer.subscription.created":
            case "customer.subscription.updated":
            case "customer.subscription.deleted":
            {
                if (stripeEvent.Data.Object is Stripe.Subscription stripeSub)
                {
                    var resolvedUserId = await mirrorService.ApplyAsync(stripeSub, ct);
                    if (resolvedUserId.HasValue)
                        cache.Remove($"ent:{resolvedUserId.Value:N}");
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

    // Story 2.3 — read spectr_user_id off arbitrary Stripe metadata.
    // Both Subscription and PaymentIntent objects propagate the field
    // when we set it at customer/session creation time.
    private static bool TryReadUserMetadata(
        IDictionary<string, string>? metadata, out Guid userId)
    {
        userId = default;
        return metadata is not null
            && metadata.TryGetValue("spectr_user_id", out var raw)
            && Guid.TryParse(raw, out userId);
    }

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
