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
    // Returns the resolved userId on success, null if the user could not be found.
    // Callers use the returned userId to invalidate per-user caches (story 2.4).
    public async Task<Guid?> ApplyAsync(StripeSubscription stripeSub, CancellationToken ct)
    {
        var userId = await ResolveUserIdAsync(stripeSub, ct);
        if (userId is null)
        {
            logger.LogWarning(
                "Subscription webhook for unresolvable user — stripe_customer_id={CustomerId}, stripe_subscription_id={SubscriptionId}. Skipping.",
                stripeSub.CustomerId, stripeSub.Id);
            return null;
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
            return null;
        }

        var existing = await db.Subscriptions
            .FirstOrDefaultAsync(s => s.UserId == userId.Value, ct);

        // review-fix P20 — missing period_end is a Stripe API anomaly, not a
        // signal that the subscription expired right now. Substitute a
        // sentinel far-future date so tier-derivation predicates don't
        // mistakenly flip the user to "free" because of a transport hiccup
        // that dropped the field. The reconciliation job (story 2.10) will
        // re-query the canonical state.
        var periodEndRaw = firstItem?.CurrentPeriodEnd ?? default;
        var periodEnd = periodEndRaw == default
            ? DateTimeOffset.UtcNow.AddYears(10)
            : new DateTimeOffset(periodEndRaw, TimeSpan.Zero);

        DateTimeOffset? cancelAt = stripeSub.CancelAt is null
            ? null
            : new DateTimeOffset(stripeSub.CancelAt.Value, TimeSpan.Zero);

        // Story 2.2 — capture the Stripe SubscriptionItem id so the
        // change-cadence endpoint can swap the price without a roundtrip
        // to Stripe just to learn the item id.
        var itemId = firstItem?.Id;

        // Story 2.2 review-fix P9 — only overwrite StripeItemId when the
        // incoming webhook carries one. Some Stripe events
        // (subscription.deleted, certain edge-case payloads) deliver empty
        // items arrays; unconditional assignment would wipe a valid si_* id
        // and re-introduce `subscription_not_ready` 409 for the user until
        // the next item-bearing webhook.
        void ApplyTo(SubscriptionEntity row)
        {
            row.StripeCustomerId = stripeSub.CustomerId;
            row.StripeSubscriptionId = stripeSub.Id;
            if (itemId is not null)
            {
                row.StripeItemId = itemId;
            }
            row.Status = stripeSub.Status;
            row.PriceId = priceId;
            row.CurrentPeriodEnd = periodEnd;
            row.CancelAt = cancelAt;
            // Story 2.9 — recovery (AC #4) belt-and-suspenders: a
            // subscription returning to active/trialing clears any pending
            // dunning retry date, even if the matching invoice.paid event
            // wasn't dispatched/matched. Leave it untouched for past_due so
            // the DunningBanner keeps showing the scheduled retry.
            if (stripeSub.Status is "active" or "trialing")
            {
                row.NextPaymentAttempt = null;
            }
            row.UpdatedAt = DateTimeOffset.UtcNow;
        }

        if (existing is null)
        {
            db.Subscriptions.Add(new SubscriptionEntity
            {
                UserId = userId.Value,
                StripeCustomerId = stripeSub.CustomerId,
                StripeSubscriptionId = stripeSub.Id,
                StripeItemId = itemId,
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
            ApplyTo(existing);
        }

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (existing is null
            && ex.InnerException is Npgsql.PostgresException { SqlState: "23505" })
        {
            // Concurrent delivery of the same subscription event (Stripe is
            // at-least-once and fans out duplicates): another handler won the
            // read-then-insert race and the PK rejected our insert. Re-apply
            // as an update against the winner's row — same terminal state,
            // and the endpoint answers 200 instead of 500 (which would make
            // Stripe redeliver forever).
            db.ChangeTracker.Clear();
            var winner = await db.Subscriptions
                .FirstAsync(s => s.UserId == userId.Value, ct);
            ApplyTo(winner);
            await db.SaveChangesAsync(ct);
        }
        return userId;
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
