using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Spectr.Data.Entities;

// Listen V3 (PRP-2, Δ1) — the version-scoped sharing gate bundle. 1:1 with a
// song_version (PK = song_version_id, mirrors Subscription's user_id PK). ABSENCE
// of a row == private (default). This is a NEW parallel path beside the untouched
// analysis-scoped share (analyses.share_token / ShareEndpoints) — do not merge them.
// CHECK constraints + the partial-unique share_token index live in OnModelCreating
// / the migration. Token is minted lazily (only when visibility leaves 'private').

[Table("share_settings")]
public sealed class ShareSetting
{
    [Column("song_version_id")]
    public Guid SongVersionId { get; set; }

    // CHECK in ('private','unlisted','public'); default 'private'.
    [Column("visibility"), MaxLength(12)]
    public string Visibility { get; set; } = "private";

    // URL-safe opaque token (ShareEndpoints.GenerateToken recipe). Null while private.
    [Column("share_token"), MaxLength(36)]
    public string? ShareToken { get; set; }

    [Column("show_verdicts")]
    public bool ShowVerdicts { get; set; }

    // CHECK in ('off','link','named'); 'named' => account required (D4.4), 'link' => anon ok.
    [Column("comments_policy"), MaxLength(8)]
    public string CommentsPolicy { get; set; } = "link";

    [Column("suggestions_allowed")]
    public bool SuggestionsAllowed { get; set; } = true;

    [Column("bookmarking_allowed")]
    public bool BookmarkingAllowed { get; set; } = true;

    // CHECK in ('owner_only','invited').
    [Column("session_host_policy"), MaxLength(12)]
    public string SessionHostPolicy { get; set; } = "owner_only";

    // CHECK in ('invited','link','public').
    [Column("session_join_policy"), MaxLength(8)]
    public string SessionJoinPolicy { get; set; } = "link";

    // Set when sharing is first enabled (visibility leaves 'private').
    [Column("enabled_at")]
    public DateTimeOffset? EnabledAt { get; set; }

    [Column("created_at")]
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    [Column("updated_at")]
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
