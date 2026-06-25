using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

// Polymorphic target: EXACTLY ONE of target_share_token / target_published_track /
// target_version_id is set, enforced by a 3-way CHECK (PRP-3 swapped the original
// 2-way). The legacy /share path uses target_share_token; Listen V3 View comments
// use target_version_id. Threaded (parent_id self-FK), author-moderated (status).

[Table("track_comments")]
public sealed class TrackComment
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Column("target_share_token"), MaxLength(36)]
    public string? TargetShareToken { get; set; }

    [Column("target_published_track")]
    public Guid? TargetPublishedTrack { get; set; }

    // Listen V3 (PRP-3) — version-scoped View comments.
    [Column("target_version_id")]
    public Guid? TargetVersionId { get; set; }

    // Threading — nullable self-FK. Arbitrary depth stored; the UI renders one level.
    [Column("parent_id")]
    public Guid? ParentId { get; set; }

    // Author-owned moderation status (single column, NOT a per-user overlay).
    // CHECK in ('open','resolved','pinned','hidden'); default 'open'.
    [Column("status"), MaxLength(10)]
    public string Status { get; set; } = "open";

    // Attached reviewer suggestion (bidirectional with suggestions.comment_id).
    [Column("suggestion_id")]
    public Guid? SuggestionId { get; set; }

    [Column("author_user_id")]
    public Guid? AuthorUserId { get; set; }    // null = anonymous reviewer

    [Column("author_display_name"), MaxLength(120)]
    public string? AuthorDisplayName { get; set; }

    [Column("author_ip_hash")]
    public byte[]? AuthorIpHash { get; set; }    // legacy /share path only (salted SHA-256)

    // Durable signed-cookie anon id (LISTEN_V3_CONVENTIONS §1 — new anon-capable
    // columns key on anonId, not ip_hash). Set for anon V3 View comments.
    [Column("author_anon_id"), MaxLength(64)]
    public string? AuthorAnonId { get; set; }

    [Column("timestamp_seconds")]
    public double? TimestampSeconds { get; set; }    // null = general comment

    [Column("body")]
    public required string Body { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    [Column("deleted_at")]
    public DateTimeOffset? DeletedAt { get; set; }    // producer-side hide / soft-delete
}

// Listen V3 (PRP-6) — a viewer bookmarks a VERSION (target_version_id), optionally
// at a moment (t_seconds) + with a note; named viewers may opt to let the author
// see them (identity_visible). Anon-capable (nullable user_id + the anon pair),
// mirroring the track_comments anon model. Polymorphic target: EXACTLY ONE of
// target_share_token / target_published_track / target_version_id (3-way CHECK,
// swapped from the original 2-way — the legacy /share path keeps target_share_token).
[Table("track_bookmarks")]
public sealed class TrackBookmark
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    // Nullable now: anon bookmarks have no user_id (they use bookmarker_anon_id).
    [Column("user_id")]
    public Guid? UserId { get; set; }

    [Column("target_share_token"), MaxLength(36)]
    public string? TargetShareToken { get; set; }

    [Column("target_published_track")]
    public Guid? TargetPublishedTrack { get; set; }

    // Listen V3 (PRP-6) — version-scoped bookmark target.
    [Column("target_version_id")]
    public Guid? TargetVersionId { get; set; }

    // Anon attribution keys on the durable signed-cookie anonId (LISTEN_V3
    // CONVENTIONS §1), NOT an ip_hash — stable across restarts/NAT, so the anon
    // count + dedup are durable (resolves the spec's G1). The display name is
    // for the author signal only when the bookmarker opts in.
    [Column("bookmarker_display_name"), MaxLength(120)]
    public string? BookmarkerDisplayName { get; set; }

    [Column("bookmarker_anon_id"), MaxLength(64)]
    public string? BookmarkerAnonId { get; set; }

    [Column("timestamp_seconds")]
    public double? TimestampSeconds { get; set; }    // null = whole-version bookmark

    [Column("note"), MaxLength(280)]
    public string? Note { get; set; }

    // D5.4 opt-in: a NAMED bookmarker letting the author see they bookmarked.
    // Default false (author sees only an aggregate count); anon is NEVER identified.
    [Column("identity_visible")]
    public bool IdentityVisible { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
