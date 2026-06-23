using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

// Story 2.1 / Architecture D2 — local mirror of the Stripe subscription
// state for this user. PK = user_id (1:1; architecture line 91 "keyed by
// user"). Updated ONLY by the webhook processor (SubscriptionMirrorService)
// — no other code path mutates this table. Reads are free.
//
// Stripe lifecycle states (Status column):
//   incomplete | incomplete_expired | trialing | active | past_due |
//   canceled | unpaid
//
// The transitional `tier` field on /me derives "pro" from Status ∈
// {active, trialing}; story 2.4 will widen this to the full
// Entitlements.For(user) resolver + 60-s cache.

[Table("subscriptions")]
public sealed class Subscription
{
    [Column("user_id")]
    public Guid UserId { get; set; }

    [Column("stripe_customer_id"), MaxLength(64)]
    public required string StripeCustomerId { get; set; }

    [Column("stripe_subscription_id"), MaxLength(64)]
    public required string StripeSubscriptionId { get; set; }

    // Story 2.2 — Stripe SubscriptionItem id. Stored so the
    // change-cadence endpoint can swap the price without first fetching
    // the subscription from Stripe just to learn the item id. Nullable
    // for backward compatibility: rows from story 2.1 (pre-this-column)
    // populate on the next customer.subscription.updated webhook.
    [Column("stripe_item_id"), MaxLength(64)]
    public string? StripeItemId { get; set; }

    [Column("status"), MaxLength(24)]
    public required string Status { get; set; }

    [Column("price_id"), MaxLength(64)]
    public required string PriceId { get; set; }

    [Column("current_period_end")]
    public DateTimeOffset CurrentPeriodEnd { get; set; }

    [Column("cancel_at")]
    public DateTimeOffset? CancelAt { get; set; }

    // Story 2.9 — the Stripe `Invoice.next_payment_attempt` for an open
    // dunning cycle (the "retrying {day}" date in the amber DunningBanner,
    // UX-DR33). Set by the invoice.payment_failed webhook; cleared on
    // invoice.paid or when the subscription returns to active/trialing.
    // Display-only — entitlement/grace access is gated purely by Status
    // (past_due keeps Pro), never by this timestamp.
    [Column("next_payment_attempt")]
    public DateTimeOffset? NextPaymentAttempt { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    [Column("updated_at")]
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
