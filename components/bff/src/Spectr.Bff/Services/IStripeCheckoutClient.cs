using Stripe;
using Stripe.Checkout;

namespace Spectr.Bff.Services;

// Story 2.1 — thin abstraction over the Stripe SDK so tests can substitute
// a fake without hitting api.stripe.com. The real impl wraps `CustomerService`
// + `SessionService`; tests replace it with a recording fake.
//
// We DO NOT abstract every Stripe primitive — only the two calls the
// checkout endpoint makes. Keeping the surface tiny means fewer test stubs.

public interface IStripeCheckoutClient
{
    Task<Customer> CreateCustomerAsync(CustomerCreateOptions options, CancellationToken ct);
    Task<Session> CreateCheckoutSessionAsync(SessionCreateOptions options, CancellationToken ct);
}

internal sealed class StripeCheckoutClient : IStripeCheckoutClient
{
    private readonly CustomerService _customers = new();
    private readonly SessionService _sessions = new();

    public Task<Customer> CreateCustomerAsync(CustomerCreateOptions options, CancellationToken ct)
        => _customers.CreateAsync(options, cancellationToken: ct);

    public Task<Session> CreateCheckoutSessionAsync(SessionCreateOptions options, CancellationToken ct)
        => _sessions.CreateAsync(options, cancellationToken: ct);
}
