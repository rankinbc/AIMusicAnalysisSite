using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

// A named, full-chain rack snapshot bound to its origin song_version. The
// version (-> song -> user) IS the owner — there is deliberately NO user_id
// here (version-scoped, not user-scoped). `source` is first-class: 'user' for
// a producer's own save; 'coach'/'analysis' are RESERVED for the future
// IPresetGenerator (PRP-8) and only ever appear with system-generated rows.
// Portability is via JSON export/import — there is NO copied_from_id / server copy.

[Table("rack_presets")]
public sealed class RackPreset
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    // Origin + owner anchor (ownership derives via song_version -> song -> user).
    [Column("song_version_id")]
    public Guid SongVersionId { get; set; }

    [Column("name"), MaxLength(120)]
    public required string Name { get; set; }

    // CHECK ('user','coach','analysis') enforced in OnModelCreating. 'user' is the
    // only value this slice writes; the other two are the reserved generation seam.
    [Column("source"), MaxLength(16)]
    public string Source { get; set; } = "user";

    // Full chain snapshot (order + per-module params + masterBypass) — mirrors
    // the frontend audio/state.ts shape; superset of Verdict.fix.dsp_chain.
    [Column("chain_json", TypeName = "jsonb")]
    public string ChainJson { get; set; } = "{}";

    // Coach-mix rationale: change log, arbiter notes, degraded flag written by
    // the `generate_fix_rack` worker actor. Null for presets created before
    // this column was added.
    [Column("coach_meta", TypeName = "jsonb")]
    public string? CoachMeta { get; set; }

    // Credit-chain provenance (no FK yet — the room-session + grant tables land
    // in PRP-4). Null for plain user saves.
    [Column("created_in_session_id")]
    public Guid? CreatedInSessionId { get; set; }

    [Column("via_grant_id")]
    public Guid? ViaGrantId { get; set; }

    // Set when this preset was forked by accepting a reviewer suggestion (PRP-3,
    // D4.5 credit chain → suggestions.from_actor). FK to suggestions.
    [Column("from_suggestion_id")]
    public Guid? FromSuggestionId { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    [Column("updated_at")]
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
