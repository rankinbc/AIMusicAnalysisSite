using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

// Listen V3 (PRP-4, D3.1/D3.2) — a live Room: several people listen to one
// version together (host-driven transport/visuals, presence, reactions, chat,
// independent rack/visuals control handoff). JSON-FIRST durability (D3.2,
// mirroring analyses.final_json): high-frequency events live in the Redis WAL
// `room:{id}:log` during the session and are flushed to events_json exactly
// ONCE at finalize by the synthesize_recap actor (the sole flusher); recap_json
// is the actor's derived projection. No row-per-event table.
[Table("listening_sessions")]
public sealed class ListeningSession
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Column("song_version_id")]
    public Guid SongVersionId { get; set; }

    [Column("host_id")]
    public Guid HostId { get; set; }

    // CHECK in ('live','ended'); default 'live'. The finalize CAS flips this
    // live→ended exactly once (events_json written in the same UPDATE).
    [Column("status"), MaxLength(8)]
    public string Status { get; set; } = "live";

    [Column("started_at")]
    public DateTimeOffset StartedAt { get; set; } = DateTimeOffset.UtcNow;

    [Column("ended_at")]
    public DateTimeOffset? EndedAt { get; set; }

    // The durable event archive — the Redis log flushed at finalize (D3.2).
    // Null while live.
    [Column("events_json", TypeName = "jsonb")]
    public string? EventsJson { get; set; }

    // Derived recap (hottest moments + histogram + peak concurrency + attendance).
    // Written by synthesize_recap after the events_json flush. Null while live.
    [Column("recap_json", TypeName = "jsonb")]
    public string? RecapJson { get; set; }

    // Story 11.10 — set the FIRST time the host publishes the recap (recap_json
    // alone is auto-synthesized on room end, so non-null recap_json != published).
    // Feed publish-signal AND sort key; never reset on re-publish.
    [Column("recap_published_at")]
    public DateTimeOffset? RecapPublishedAt { get; set; }
}
