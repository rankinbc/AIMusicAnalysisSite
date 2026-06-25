using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

// The owner's single autosaved working chain for a song_version, so unsaved
// rack tweaks survive a reload. UNIQUE(song_version_id) — exactly one draft per
// version (configured in OnModelCreating). Version-scoped (NO user_id), like
// RackPreset: a non-owner's in-progress tweak stays client-local until they
// submit a Suggestion (PRP-3); Room edits write the session shared chain (PRP-4),
// never this personal draft — the three never clobber each other.

[Table("rack_drafts")]
public sealed class RackDraft
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Column("song_version_id")]
    public Guid SongVersionId { get; set; }

    [Column("chain_json", TypeName = "jsonb")]
    public string ChainJson { get; set; } = "{}";

    [Column("updated_at")]
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
