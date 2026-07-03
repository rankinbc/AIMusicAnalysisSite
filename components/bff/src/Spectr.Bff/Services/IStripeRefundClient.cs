using Stripe;

namespace Spectr.Bff.Services;

// Story 10.5 (FR46) — Stripe refunds for the admin surface. Same thin-
// wrapper pattern as IStripeSubscriptionClient: DI-substitutable, every
// mutation carries a deterministic IdempotencyKey (a double-click refunds
// once per payment intent).
public interface IStripeRefundClient
{
    Task<Refund> CreateRefundAsync(string paymentIntentId, CancellationToken ct);
}

public sealed class StripeRefundClient : IStripeRefundClient
{
    private readonly RefundService _refunds = new();

    public Task<Refund> CreateRefundAsync(string paymentIntentId, CancellationToken ct)
        => _refunds.CreateAsync(
            new RefundCreateOptions { PaymentIntent = paymentIntentId },
            new RequestOptions { IdempotencyKey = $"admin-refund:{paymentIntentId}" },
            ct);
}
