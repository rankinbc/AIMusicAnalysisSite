using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

// Story 2.3 / AR16 — append-only monetization-level event log.
// Written at job dispatch (in the same transaction as the
// credit_ledger -1 spend) and at coach-message send (story 2.6).
// Story 2.4's Entitlements.For(user) rolls these up per
// billing_period to compute remaining-analyses / remaining-coach
// allowances.
//
// NEVER UPDATE — period rollups are materialized from the
// append-only event stream.

[Table("usage_events")]
public sealed class UsageEvent
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Column("user_id")]
    public Guid UserId { get; set; }

    // CHECK constraint enforces one of:
    //   'analysis' | 'coach_message'
    [Column("event_type"), MaxLength(24)]
    public required string EventType { get; set; }

    // ISO-8601 yyyy-MM. Composite index (user_id, billing_period) for
    // story 2.4's per-period rollup queries.
    [Column("billing_period"), MaxLength(7)]
    public required string BillingPeriod { get; set; }

    // Analysis job id (string-formatted Guid) for 'analysis' events;
    // coach message id for 'coach_message' events.
    [Column("reference"), MaxLength(128)]
    public string? Reference { get; set; }

    [Column("occurred_at")]
    public DateTimeOffset OccurredAt { get; set; } = DateTimeOffset.UtcNow;
}
