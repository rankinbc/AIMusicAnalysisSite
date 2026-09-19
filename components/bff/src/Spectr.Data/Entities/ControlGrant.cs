using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

// Listen V3 (PRP-4, D3.5/D4.6) — the provenance backbone: the host delegates
// rack OR visuals control to a participant (grantee, anon-capable actor reference).
// This is the FK target for rack_presets.via_grant_id + suggestions.via_grant_id,
// so it is the EXCEPTION to JSON-first durability — written to Postgres
// immediately (low frequency; must be durable NOW because a preset saved live
// references via_grant_id as an FK).
//
// ONE ACTIVE HOLDER PER SCOPE (seams §2 / decision D3): a partial-unique index
// (session_id, scope) WHERE revoked_at IS NULL — raw SQL in the migration.
// Granting a scope already held auto-sets revoked_at on the prior active grant
// in the SAME tx, then inserts the new one.
//
// anon grantee attribution keys on the signed-cookie anonId (LISTEN_V3
// CONVENTIONS §1), NOT an ip_hash — mirrors ReviewerSuggestion.from_anon_id.
[Table("control_grants")]
public sealed class ControlGrant
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Column("session_id")]
    public Guid SessionId { get; set; }

    // CHECK in ('rack','visuals') — exactly the two delegable scopes.
    [Column("scope"), MaxLength(8)]
    public required string Scope { get; set; }

    // Grantee identity (anon-capable): a user id OR a (display_name, anon_id) pair.
    [Column("grantee_user_id")]
    public Guid? GranteeUserId { get; set; }

    [Column("grantee_display_name"), MaxLength(120)]
    public string? GranteeDisplayName { get; set; }

    [Column("grantee_anon_id"), MaxLength(64)]
    public string? GranteeAnonId { get; set; }

    // The host who granted (always an authed user — host is owner/invited host).
    [Column("granted_by")]
    public Guid GrantedBy { get; set; }

    [Column("granted_at")]
    public DateTimeOffset GrantedAt { get; set; } = DateTimeOffset.UtcNow;

    // Null = currently active. Set on explicit revoke OR auto-revoke when a new
    // grant for the same (session, scope) supersedes it.
    [Column("revoked_at")]
    public DateTimeOffset? RevokedAt { get; set; }
}
