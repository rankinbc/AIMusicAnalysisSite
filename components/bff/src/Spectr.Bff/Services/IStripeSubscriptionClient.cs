using Stripe;
using StripeBillingPortalSessionService = Stripe.BillingPortal.SessionService;
using StripeBillingPortalSession = Stripe.BillingPortal.Session;
using StripeBillingPortalSessionCreateOptions = Stripe.BillingPortal.SessionCreateOptions;

namespace Spectr.Bff.Services;

// Story 2.2 — abstraction over Stripe.SubscriptionService +
// Stripe.BillingPortal.SessionService so the manage-subscription
// endpoints can be DI-substituted in tests. Mirrors the
// IStripeCheckoutClient pattern from story 2.1.
//
// Every call carries an IdempotencyKey via RequestOptions so retries
// are no-ops on Stripe's side (story 2.1 review patch P1).

public interface IStripeSubscriptionClient
{
    Task<Subscription> UpdateAsync(
        string subscriptionId,
        SubscriptionUpdateOptions options,
        string idempotencyKey,
        CancellationToken ct);

    Task<StripeBillingPortalSession> CreatePortalSessionAsync(
        StripeBillingPortalSessionCreateOptions options,
        string idempotencyKey,
        CancellationToken ct);
}

internal sealed class StripeSubscriptionClient : IStripeSubscriptionClient
{
    private readonly SubscriptionService _subscriptions = new();
    private readonly StripeBillingPortalSessionService _portal = new();

    public Task<Subscription> UpdateAsync(
        string subscriptionId,
        SubscriptionUpdateOptions options,
        string idempotencyKey,
        CancellationToken ct)
        => _subscriptions.UpdateAsync(
            subscriptionId,
            options,
            new RequestOptions { IdempotencyKey = idempotencyKey },
            cancellationToken: ct);

    public Task<StripeBillingPortalSession> CreatePortalSessionAsync(
        StripeBillingPortalSessionCreateOptions options,
        string idempotencyKey,
        CancellationToken ct)
        => _portal.CreateAsync(
            options,
            new RequestOptions { IdempotencyKey = idempotencyKey },
            cancellationToken: ct);
}
