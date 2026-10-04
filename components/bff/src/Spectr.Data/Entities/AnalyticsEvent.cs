using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

// F1b — FIRST-PARTY product analytics: the acquisition funnel recorded in our
// own database instead of a third-party tool (owner decision 2026-10-04).
// Append-only; written only by POST /api/events (EventEndpoints).
//
// Deliberately minimal: NO ip address, NO user agent, NO email, no free text.
// `session_id` is a random per-tab id (sessionStorage — gone when the tab
// closes); `user_id` is set when the caller is signed in (a guest is a real
// users row, so one id spans upload → report → sign-up). No FK on user_id:
// guest rows are purged and the funnel history must outlive them; account
// deletion removes the user's events explicitly (AccountTeardown).
[Table("analytics_events")]
public sealed class AnalyticsEvent
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Column("occurred_at")]
    public DateTimeOffset OccurredAt { get; set; } = DateTimeOffset.UtcNow;

    // One of EventEndpoints.KnownEvents — anything else is dropped unread.
    [Column("event"), MaxLength(48)]
    public required string Event { get; set; }

    [Column("session_id"), MaxLength(36)]
    public string? SessionId { get; set; }

    [Column("user_id")]
    public Guid? UserId { get; set; }

    // Path only (no query string, no hash); id segments collapsed to ":id".
    [Column("path"), MaxLength(128)]
    public string? Path { get; set; }

    // Small flat object of primitives (e.g. { "product": "credits" }).
    [Column("props", TypeName = "jsonb")]
    public string? Props { get; set; }

    // First-touch attribution, same sanitizer as users.signup_* (F1).
    [Column("source"), MaxLength(64)]
    public string? Source { get; set; }

    [Column("medium"), MaxLength(64)]
    public string? Medium { get; set; }

    [Column("campaign"), MaxLength(64)]
    public string? Campaign { get; set; }

    [Column("referrer"), MaxLength(128)]
    public string? Referrer { get; set; }
}
