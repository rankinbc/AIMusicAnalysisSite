using Microsoft.EntityFrameworkCore;
using Spectr.Data;
using StripeSubscription = Stripe.Subscription;
using SubscriptionEntity = Spectr.Data.Entities.Subscription;

namespace Spectr.Bff.Services;

// Story 2.1 / Architecture D2 — the ONLY writer to the `subscriptions`
// mirror table. The webhook endpoint dispatches `customer.subscription.*`
// events here; no other code path is allowed to mutate the table.
//
// User resolution order:
//   1. stripeSubscription.Metadata["spectr_user_id"] (preferred — explicit)
//   2. Look up the user via Subscription.StripeCustomerId (the user was
//      created at checkout-session time and the customer id is on their row)
//   3. Look up the user via User.StripeCustomerId (set when the customer
//      was first created — before any subscription row existed)
//
// If all three fail, log + return (do NOT insert orphan rows). The
// reconciliation job (story 2.10) will catch drift.

public sealed class SubscriptionMirrorService(
    AppDbContext db,
    ILogger<SubscriptionMirrorService> logger)
{
    public async Task ApplyAsync(StripeSubscription stripeSub, CancellationToken ct)
    {
        var userId = await ResolveUserIdAsync(stripeSub, ct);
        if (userId is null)
        {
            logger.LogWarning(
                "Subscription webhook for unresolvable user — stripe_customer_id={CustomerId}, stripe_subscription_id={SubscriptionId}. Skipping.",
                stripeSub.CustomerId, stripeSub.Id);
            return;
        }

        // Stripe.net 52: period_end + price live on the SubscriptionItem
        // (per-item billing periods landed in the 2024 API restructure).
        var firstItem = stripeSub.Items?.Data?.FirstOrDefault();
        var priceId = firstItem?.Price?.Id;
        if (string.IsNullOrEmpty(priceId))
        {
            logger.LogWarning(
                "Subscription webhook missing price id — stripe_subscription_id={SubscriptionId}. Skipping.",
                stripeSub.Id);
            return;
        }

        var existing = await db.Subscriptions
            .FirstOrDefaultAsync(s => s.UserId == userId.Value, ct);

        var periodEndRaw = firstItem?.CurrentPeriodEnd ?? default;
        var periodEnd = periodEndRaw == default
            ? DateTimeOffset.UtcNow
            : new DateTimeOffset(periodEndRaw, TimeSpan.Zero);

        DateTimeOffset? cancelAt = stripeSub.CancelAt is null
            ? null
            : new DateTimeOffset(stripeSub.CancelAt.Value, TimeSpan.Zero);

        if (existing is null)
        {
            db.Subscriptions.Add(new SubscriptionEntity
            {
                UserId = userId.Value,
                StripeCustomerId = stripeSub.CustomerId,
                StripeSubscriptionId = stripeSub.Id,
                Status = stripeSub.Status,
                PriceId = priceId,
                CurrentPeriodEnd = periodEnd,
                CancelAt = cancelAt,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
        }
        else
        {
            existing.StripeCustomerId = stripeSub.CustomerId;
            existing.StripeSubscriptionId = stripeSub.Id;
            existing.Status = stripeSub.Status;
            existing.PriceId = priceId;
            existing.CurrentPeriodEnd = periodEnd;
            existing.CancelAt = cancelAt;
            existing.UpdatedAt = DateTimeOffset.UtcNow;
        }

        await db.SaveChangesAsync(ct);
    }

    private async Task<Guid?> ResolveUserIdAsync(StripeSubscription stripeSub, CancellationToken ct)
    {
        // 1) Explicit metadata wins — set by the checkout endpoint when the
        //    Customer was created. Propagates to the Subscription via Stripe.
        if (stripeSub.Metadata is not null
            && stripeSub.Metadata.TryGetValue("spectr_user_id", out var metaId)
            && Guid.TryParse(metaId, out var fromMeta))
        {
            return fromMeta;
        }

        // 2) Existing subscription row referencing this customer id.
        var byMirror = await db.Subscriptions
            .AsNoTracking()
            .Where(s => s.StripeCustomerId == stripeSub.CustomerId)
            .Select(s => (Guid?)s.UserId)
            .FirstOrDefaultAsync(ct);
        if (byMirror is not null) return byMirror;

        // 3) User row stamped with this customer id (checkout-time write).
        var byUser = await db.Users
            .AsNoTracking()
            .Where(u => u.StripeCustomerId == stripeSub.CustomerId)
            .Select(u => (Guid?)u.Id)
            .FirstOrDefaultAsync(ct);
        return byUser;
    }
}
