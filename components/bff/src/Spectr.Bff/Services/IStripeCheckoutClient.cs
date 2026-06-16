using Stripe;
using Stripe.Checkout;

namespace Spectr.Bff.Services;

// Story 2.1 — thin abstraction over the Stripe SDK so tests can substitute
// a fake without hitting api.stripe.com. The real impl wraps `CustomerService`
// + `SessionService`; tests replace it with a recording fake.
//
// We DO NOT abstract every Stripe primitive — only the two calls the
// checkout endpoint makes. Keeping the surface tiny means fewer test stubs.
//
// review-fix P1 — every call carries an `IdempotencyKey` (Stripe's official
// retry-safety primitive). Without it, a dropped response from Stripe could
// cause a second customer or a second Checkout session to be created on
// retry, exposing the user to duplicate billing. The key is caller-supplied
// so the BFF can derive deterministic keys from the user id + operation
// (e.g. "checkout_session:<userId>:<cadence>:<request-id>").

public interface IStripeCheckoutClient
{
    Task<Customer> CreateCustomerAsync(
        CustomerCreateOptions options,
        string idempotencyKey,
        CancellationToken ct);

    Task<Session> CreateCheckoutSessionAsync(
        SessionCreateOptions options,
        string idempotencyKey,
        CancellationToken ct);
}

internal sealed class StripeCheckoutClient : IStripeCheckoutClient
{
    private readonly CustomerService _customers = new();
    private readonly SessionService _sessions = new();

    public Task<Customer> CreateCustomerAsync(
        CustomerCreateOptions options,
        string idempotencyKey,
        CancellationToken ct)
        => _customers.CreateAsync(
            options,
            new RequestOptions { IdempotencyKey = idempotencyKey },
            cancellationToken: ct);

    public Task<Session> CreateCheckoutSessionAsync(
        SessionCreateOptions options,
        string idempotencyKey,
        CancellationToken ct)
        => _sessions.CreateAsync(
            options,
            new RequestOptions { IdempotencyKey = idempotencyKey },
            cancellationToken: ct);
}
