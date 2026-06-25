using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

// Listen V3 (PRP-2, D6.3) — a named, tokenized invitation to a version (and
// structurally ready for session scope in PRP-4). reviewer/listener/host roles;
// pending/accepted/revoked. Accepting binds invited_user_id (or a logged-in user
// via the token). CHECK constraints + unique(token) live in OnModelCreating.

[Table("invites")]
public sealed class Invite
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    // CHECK in ('version','session'); 'session' reserved for PRP-4 (session_id, no FK yet).
    [Column("scope"), MaxLength(8)]
    public string Scope { get; set; } = "version";

    [Column("song_version_id")]
    public Guid? SongVersionId { get; set; }

    // No FK yet — the room_sessions table lands in PRP-4.
    [Column("session_id")]
    public Guid? SessionId { get; set; }

    [Column("invited_user_id")]
    public Guid? InvitedUserId { get; set; }

    [Column("invited_email"), MaxLength(255)]
    public string? InvitedEmail { get; set; }

    [Column("invited_handle"), MaxLength(32)]
    public string? InvitedHandle { get; set; }

    // CHECK in ('reviewer','listener','host').
    [Column("role"), MaxLength(16)]
    public required string Role { get; set; }

    [Column("token"), MaxLength(36)]
    public required string Token { get; set; }

    // CHECK in ('pending','accepted','revoked'); default 'pending'.
    [Column("status"), MaxLength(10)]
    public string Status { get; set; } = "pending";

    [Column("created_by")]
    public Guid CreatedBy { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    [Column("accepted_at")]
    public DateTimeOffset? AcceptedAt { get; set; }
}
