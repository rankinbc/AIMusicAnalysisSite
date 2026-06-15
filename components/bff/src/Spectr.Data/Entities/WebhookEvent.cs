using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

// Story 2.1 / AR11 — Stripe webhook idempotency. The Stripe event.id is
// the PK; INSERT … ON CONFLICT (id) DO NOTHING gives at-most-once dispatch
// under Stripe's at-least-once delivery semantics. processed_at flips
// to NOW() after the in-process dispatch succeeds; on exception it stays
// NULL and the processing_error field captures the failure for ops triage.
//
// PCI hygiene: we store the payload HASH (SHA-256 hex of the raw body)
// for replay debugging — NEVER the full payload. The raw body would
// include customer email / billing address / metadata which is PII; the
// hash is enough to confirm a replay matches without retaining the data.

[Table("webhook_events")]
public sealed class WebhookEvent
{
    [Column("id"), MaxLength(64)]
    public required string Id { get; set; }

    [Column("event_type"), MaxLength(64)]
    public required string EventType { get; set; }

    [Column("payload_hash"), MaxLength(64)]
    public required string PayloadHash { get; set; }

    [Column("received_at")]
    public DateTimeOffset ReceivedAt { get; set; } = DateTimeOffset.UtcNow;

    [Column("processed_at")]
    public DateTimeOffset? ProcessedAt { get; set; }

    [Column("processing_error"), MaxLength(2000)]
    public string? ProcessingError { get; set; }
}
