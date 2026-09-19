using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

// Listen V3 (PRP-3, D4.3) — the single convergence point for a NON-owner chain
// proposal (async View reviewer now; live Room grantee in PRP-4 via
// created_in_session_id). The proposed chain lives HERE (chain_json) — the
// proposer keeps no RackPreset; a RackPreset materializes only on accept
// (fork-to-preset), carrying from_suggestion_id back to this row (credit chain).
//
// Named ReviewerSuggestion in code (G3) to disambiguate from
// compare_cache.suggestions (JSONB) and GamePlanItem — the table is "suggestions".
[Table("suggestions")]
public sealed class ReviewerSuggestion
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Column("song_version_id")]
    public Guid SongVersionId { get; set; }

    // Proposer (anon-capable actor reference). anon attribution = signed-cookie anonId
    // (LISTEN_V3_CONVENTIONS §1), never an ip_hash.
    [Column("from_user_id")]
    public Guid? FromUserId { get; set; }

    [Column("from_display_name"), MaxLength(120)]
    public string? FromDisplayName { get; set; }

    [Column("from_anon_id"), MaxLength(64)]
    public string? FromAnonId { get; set; }

    [Column("chain_json", TypeName = "jsonb")]
    public string ChainJson { get; set; } = "{}";

    [Column("comment_id")]
    public Guid? CommentId { get; set; }

    // Room provenance — no FK yet (PRP-4). Rides onto the adopted preset (D4.5).
    [Column("created_in_session_id")]
    public Guid? CreatedInSessionId { get; set; }

    [Column("via_grant_id")]
    public Guid? ViaGrantId { get; set; }

    // CHECK in ('proposed','auditioned','accepted','rejected'); default 'proposed'.
    [Column("status"), MaxLength(10)]
    public string Status { get; set; } = "proposed";

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    [Column("resolved_at")]
    public DateTimeOffset? ResolvedAt { get; set; }
}
