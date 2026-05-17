using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

// Polymorphic target: one of target_share_token / target_published_track is set, enforced by CHECK.
// In v1.5 only target_share_token is used; target_published_track activates when Discover ships.

[Table("track_comments")]
public sealed class TrackComment
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Column("target_share_token"), MaxLength(36)]
    public string? TargetShareToken { get; set; }

    [Column("target_published_track")]
    public Guid? TargetPublishedTrack { get; set; }

    [Column("author_user_id")]
    public Guid? AuthorUserId { get; set; }    // null = anonymous reviewer

    [Column("author_display_name"), MaxLength(120)]
    public string? AuthorDisplayName { get; set; }

    [Column("author_ip_hash")]
    public byte[]? AuthorIpHash { get; set; }    // salted SHA-256, 90-day TTL

    [Column("timestamp_seconds")]
    public double? TimestampSeconds { get; set; }    // null = general comment

    [Column("body")]
    public required string Body { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    [Column("deleted_at")]
    public DateTimeOffset? DeletedAt { get; set; }    // producer-side hide
}

[Table("track_bookmarks")]
public sealed class TrackBookmark
{
    [Column("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Column("user_id")]
    public Guid UserId { get; set; }

    [Column("target_share_token"), MaxLength(36)]
    public string? TargetShareToken { get; set; }

    [Column("target_published_track")]
    public Guid? TargetPublishedTrack { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
