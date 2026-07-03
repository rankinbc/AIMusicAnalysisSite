using Stripe;

namespace Spectr.Bff.Services;

// Story 10.5 (FR46) — Stripe refunds for the admin surface. Same thin-
// wrapper pattern as IStripeSubscriptionClient: DI-substitutable, every
// mutation carries a deterministic IdempotencyKey (a double-click refunds
// once per payment intent).
public interface IStripeRefundClient
{
    Task<Refund> CreateRefundAsync(string paymentIntentId, CancellationToken ct);

    /// <summary>Ownership check: the intent's customer id (null if the
    /// intent doesn't exist).</summary>
    Task<string?> GetIntentCustomerIdAsync(string paymentIntentId, CancellationToken ct);
}

public sealed class StripeRefundClient : IStripeRefundClient
{
    private readonly RefundService _refunds = new();
    private readonly PaymentIntentService _intents = new();

    public Task<Refund> CreateRefundAsync(string paymentIntentId, CancellationToken ct)
        => _refunds.CreateAsync(
            new RefundCreateOptions { PaymentIntent = paymentIntentId },
            new RequestOptions { IdempotencyKey = $"admin-refund:{paymentIntentId}" },
            ct);

    public async Task<string?> GetIntentCustomerIdAsync(string paymentIntentId, CancellationToken ct)
    {
        try
        {
            var pi = await _intents.GetAsync(paymentIntentId, cancellationToken: ct);
            return pi?.CustomerId;
        }
        catch (StripeException e) when (e.StripeError?.Code == "resource_missing")
        {
            return null;
        }
    }
}
