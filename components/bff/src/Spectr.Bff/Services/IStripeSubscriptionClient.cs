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

    // Story 2.10 — read-only lookups for nightly reconciliation. No
    // IdempotencyKey on GET calls. Returns null when the resource is
    // gone from Stripe (resource_missing); rethrows any other exception.
    Task<Subscription?> GetSubscriptionAsync(string subscriptionId, CancellationToken ct);
    Task<Price?> GetPriceAsync(string priceId, CancellationToken ct);
}

internal sealed class StripeSubscriptionClient : IStripeSubscriptionClient
{
    private readonly SubscriptionService _subscriptions = new();
    private readonly StripeBillingPortalSessionService _portal = new();
    private readonly PriceService _prices = new();

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

    public async Task<Subscription?> GetSubscriptionAsync(string subscriptionId, CancellationToken ct)
    {
        try
        {
            return await _subscriptions.GetAsync(subscriptionId, cancellationToken: ct);
        }
        catch (StripeException ex) when (ex.StripeError?.Code == "resource_missing")
        {
            return null;
        }
    }

    public async Task<Price?> GetPriceAsync(string priceId, CancellationToken ct)
    {
        try
        {
            return await _prices.GetAsync(priceId, cancellationToken: ct);
        }
        catch (StripeException ex) when (ex.StripeError?.Code == "resource_missing")
        {
            return null;
        }
    }
}
