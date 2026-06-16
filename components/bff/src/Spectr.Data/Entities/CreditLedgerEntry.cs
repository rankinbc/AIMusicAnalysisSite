using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

// Story 2.3 / AR11 / AR14 / AR16 — append-only signed ledger for the
// local credit balance. Balance = SUM(amount) over a user's rows.
// NEVER UPDATE existing rows — adjustments come as compensating entries
// (e.g. invalid-file failure → +1 reversal row, not an UPDATE of the
// original -1 spend).
//
// Reasons:
//   "purchase"  — +N from a Stripe one-time payment (mode=payment).
//                 reference = Stripe payment_intent id.
//   "spend"     — -1 at job dispatch when the user is credit-funded.
//                 reference = analysis job id.
//   "reversal"  — +1 compensating entry when a credit-funded job fails
//                 pre-pipeline validation (invalid file). reference =
//                 analysis job id. idempotency_key = "reversal:<jobId>"
//                 to prevent double-reversal under partial unique index.
//   "adjustment" — operator/admin manual entry (Epic 10 admin surface).
//
// No `expires_at` — FR29 structural invariant.

[Table("credit_ledger")]
public sealed class CreditLedgerEntry
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Column("user_id")]
    public Guid UserId { get; set; }

    // Signed integer credit delta. CHECK constraint enforces nonzero.
    [Column("amount")]
    public int Amount { get; set; }

    // CHECK constraint enforces one of:
    //   'purchase' | 'spend' | 'reversal' | 'adjustment'
    [Column("reason"), MaxLength(24)]
    public required string Reason { get; set; }

    // Stripe payment_intent id (purchase) or job uuid string (spend/reversal).
    [Column("reference"), MaxLength(128)]
    public string? Reference { get; set; }

    // Defense-in-depth idempotency at the ledger layer. Partial unique
    // index `WHERE idempotency_key IS NOT NULL`. Used for:
    //   purchase  → "credits_purchase:<stripeEventId>"
    //   reversal  → "reversal:<jobId>"
    // Spend doesn't use a key — concurrency protection comes from the
    // serializable transaction + balance check inside SpendAsync.
    [Column("idempotency_key"), MaxLength(128)]
    public string? IdempotencyKey { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
