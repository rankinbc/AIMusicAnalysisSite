using Microsoft.EntityFrameworkCore;
using Spectr.Data.Entities;

namespace Spectr.Data;

// Single Postgres database, all schema owned by EF Core migrations.
// The Python analysis worker reads/writes the same tables via its own
// SQLAlchemy models (aimusic_shared.models) — those mirror what's declared
// here. Cross-language drift is caught by fixture-roundtrip tests.

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    // Identity
    public DbSet<User> Users => Set<User>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();

    // Library
    public DbSet<Song> Songs => Set<Song>();
    public DbSet<SongVersion> SongVersions => Set<SongVersion>();

    // Analysis
    public DbSet<AnalysisJob> AnalysisJobs => Set<AnalysisJob>();
    public DbSet<Analysis> Analyses => Set<Analysis>();
    public DbSet<Verdict> Verdicts => Set<Verdict>();
    public DbSet<VerdictUserState> VerdictUserStates => Set<VerdictUserState>();
    public DbSet<PromptVersion> PromptVersions => Set<PromptVersion>();
    public DbSet<LlmCall> LlmCalls => Set<LlmCall>();

    // Coach (story 1.5)
    public DbSet<Conversation> Conversations => Set<Conversation>();
    public DbSet<CoachMessage> CoachMessages => Set<CoachMessage>();

    // Listen
    public DbSet<SessionNote> SessionNotes => Set<SessionNote>();

    // Listen V3 — rack presets/drafts + viz presets (PRP-1)
    public DbSet<RackPreset> RackPresets => Set<RackPreset>();
    public DbSet<RackDraft> RackDrafts => Set<RackDraft>();
    public DbSet<VizPreset> VizPresets => Set<VizPreset>();

    // Listen V3 — version-scoped sharing + invites (PRP-2)
    public DbSet<ShareSetting> ShareSettings => Set<ShareSetting>();
    public DbSet<Invite> Invites => Set<Invite>();

    // References + Compare
    public DbSet<ReferenceTrack> ReferenceTracks => Set<ReferenceTrack>();
    public DbSet<ReferenceSet> ReferenceSets => Set<ReferenceSet>();
    public DbSet<ReferenceSetMember> ReferenceSetMembers => Set<ReferenceSetMember>();
    public DbSet<CompareCache> CompareCaches => Set<CompareCache>();

    // Feedback (Phase 1.5)
    public DbSet<TrackComment> TrackComments => Set<TrackComment>();
    public DbSet<TrackBookmark> TrackBookmarks => Set<TrackBookmark>();

    // Listen V3 — View feedback: reviewer suggestions (PRP-3). Table "suggestions".
    public DbSet<ReviewerSuggestion> Suggestions => Set<ReviewerSuggestion>();

    // Listen V3 — Room sessions + control grants (PRP-4)
    public DbSet<ListeningSession> ListeningSessions => Set<ListeningSession>();
    public DbSet<ControlGrant> ControlGrants => Set<ControlGrant>();

    // Billing (story 2.1)
    public DbSet<Subscription> Subscriptions => Set<Subscription>();
    public DbSet<WebhookEvent> WebhookEvents => Set<WebhookEvent>();

    // Billing (story 2.3 — append-only signed ledger + period usage log)
    public DbSet<CreditLedgerEntry> CreditLedger => Set<CreditLedgerEntry>();
    public DbSet<UsageEvent> UsageEvents => Set<UsageEvent>();

    // Billing (story 2.4 — operator-controlled feature flags)
    public DbSet<FeatureFlag> FeatureFlags => Set<FeatureFlag>();

    // Song tags (private + public, user-defined)
    public DbSet<SongTag> SongTags => Set<SongTag>();

    // Personal score — per-user × per-version rating (Change B)
    public DbSet<VersionUserRating> VersionUserRatings => Set<VersionUserRating>();

    // Compare notes — per-user × per-version-pair (Change C)
    public DbSet<VersionCompareNote> VersionCompareNotes => Set<VersionCompareNote>();

    // Notifications inbox (story 11.6)
    public DbSet<Notification> Notifications => Set<Notification>();

    // Follow graph (story 11.9)
    public DbSet<FollowRelation> FollowRelations => Set<FollowRelation>();

    // Email suppression list (story 4.2 — bounce/complaint webhook appends)
    public DbSet<EmailSuppression> EmailSuppressions => Set<EmailSuppression>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        builder.HasPostgresExtension("pgcrypto");      // gen_random_uuid()
        builder.HasPostgresExtension("citext");         // case-insensitive email/handle

        // Case-insensitive identity columns (citext on Postgres).
        // Without this, "BobR" and "bobr" are distinct handles + collision detection breaks.
        builder.Entity<User>().Property(u => u.Email).HasColumnType("citext");
        builder.Entity<User>().Property(u => u.Handle).HasColumnType("citext");

        // Composite keys
        builder.Entity<VerdictUserState>()
            .HasKey(s => new { s.VerdictId, s.UserId });
        builder.Entity<ReferenceSetMember>()
            .HasKey(m => new { m.SetId, m.ReferenceId });

        // Uniqueness
        builder.Entity<User>()
            .HasIndex(u => u.Email).IsUnique();
        builder.Entity<User>()
            .HasIndex(u => u.Handle).IsUnique();
        builder.Entity<Song>()
            .HasIndex(s => new { s.UserId, s.Name }).IsUnique()
            .HasDatabaseName("uq_songs_user_name");
        builder.Entity<SongVersion>()
            .HasIndex(v => new { v.SongId, v.VersionNumber }).IsUnique()
            .HasDatabaseName("uq_song_versions_song_number");
        builder.Entity<Analysis>()
            .HasIndex(a => a.JobId).IsUnique();
        builder.Entity<Analysis>()
            .HasIndex(a => a.ShareToken).IsUnique();
        builder.Entity<CompareCache>()
            .HasIndex(c => new { c.TrackVersionId, c.ReferenceId }).IsUnique();
        // Story 1.5: one conversation per (analysis, user) — keeps the
        // poll endpoint trivial (no list-and-merge by date).
        builder.Entity<Conversation>()
            .HasIndex(c => new { c.AnalysisId, c.UserId }).IsUnique()
            .HasDatabaseName("uq_conversations_analysis_user");

        // Partial unique index — only ONE current version per song.
        // (raw SQL because EF Core doesn't expose partial-index DSL fluently for Postgres yet)
        builder.Entity<SongVersion>().ToTable(t => t.HasCheckConstraint(
            "ck_song_versions_version_positive", "\"version_number\" > 0"));

        // Story 1.5: enum-as-string CHECKs on coach_messages role + status.
        builder.Entity<CoachMessage>().ToTable(t => t.HasCheckConstraint(
            "ck_coach_messages_role", "\"role\" IN ('user','assistant')"));
        builder.Entity<CoachMessage>().ToTable(t => t.HasCheckConstraint(
            "ck_coach_messages_status",
            "\"status\" IN ('pending','complete','refused','error')"));
        // teach-mode-coach: enum-as-string CHECK on coach_messages mode + a
        // DB default of 'qa' so existing rows backfill to a CHECK-valid value
        // (an empty-string default would violate the CHECK on create).
        builder.Entity<CoachMessage>().ToTable(t => t.HasCheckConstraint(
            "ck_coach_messages_mode", "\"mode\" IN ('qa','teach')"));
        builder.Entity<CoachMessage>().Property(m => m.Mode).HasDefaultValue("qa");

        // Polymorphic CHECK on comments — PRP-3 swapped this from 2-way to 3-way
        // (exactly one of {target_share_token, target_published_track,
        // target_version_id}). Existing share-token rows stay valid. Bookmarks keep
        // their 2-way CHECK (PRP-6 owns their re-target).
        builder.Entity<TrackComment>().ToTable(t => t.HasCheckConstraint(
            "ck_track_comments_one_target",
            "(CASE WHEN target_share_token IS NOT NULL THEN 1 ELSE 0 END "
            + "+ CASE WHEN target_published_track IS NOT NULL THEN 1 ELSE 0 END "
            + "+ CASE WHEN target_version_id IS NOT NULL THEN 1 ELSE 0 END) = 1"));
        builder.Entity<TrackComment>().ToTable(t => t.HasCheckConstraint(
            "ck_track_comments_status", "\"status\" IN ('open','resolved','pinned','hidden')"));
        builder.Entity<TrackComment>().HasIndex(c => c.TargetVersionId)
            .HasDatabaseName("ix_track_comments_target_version_id");
        builder.Entity<TrackComment>().HasIndex(c => c.ParentId)
            .HasDatabaseName("ix_track_comments_parent_id");
        builder.Entity<TrackComment>()
            .HasOne<SongVersion>().WithMany().HasForeignKey(c => c.TargetVersionId)
            .OnDelete(DeleteBehavior.Cascade);
        // Self-FK NoAction: comments are soft-deleted (deleted_at), never hard-deleted
        // except via the version cascade (which removes parent + replies together).
        builder.Entity<TrackComment>()
            .HasOne<TrackComment>().WithMany().HasForeignKey(c => c.ParentId)
            .OnDelete(DeleteBehavior.NoAction);
        builder.Entity<TrackComment>()
            .HasOne<ReviewerSuggestion>().WithMany().HasForeignKey(c => c.SuggestionId)
            .OnDelete(DeleteBehavior.SetNull);

        // Reviewer suggestions (PRP-3). Circular nullable FK with track_comments
        // (suggestion_id ↔ comment_id) — both SetNull, no hard cycle.
        builder.Entity<ReviewerSuggestion>().ToTable(t => t.HasCheckConstraint(
            "ck_suggestions_status",
            "\"status\" IN ('proposed','auditioned','accepted','rejected')"));
        builder.Entity<ReviewerSuggestion>().HasIndex(s => s.SongVersionId)
            .HasDatabaseName("ix_suggestions_song_version_id");
        builder.Entity<ReviewerSuggestion>().HasIndex(s => s.FromUserId)
            .HasDatabaseName("ix_suggestions_from_user_id");
        builder.Entity<ReviewerSuggestion>().Property(s => s.CreatedAt).HasDefaultValueSql("now()");
        builder.Entity<ReviewerSuggestion>()
            .HasOne<SongVersion>().WithMany().HasForeignKey(s => s.SongVersionId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Entity<ReviewerSuggestion>()
            .HasOne<User>().WithMany().HasForeignKey(s => s.FromUserId)
            .OnDelete(DeleteBehavior.SetNull);
        builder.Entity<ReviewerSuggestion>()
            .HasOne<TrackComment>().WithMany().HasForeignKey(s => s.CommentId)
            .OnDelete(DeleteBehavior.SetNull);

        // PRP-3 credit chain — accepted fork carries provenance back to the suggestion.
        builder.Entity<RackPreset>()
            .HasOne<ReviewerSuggestion>().WithMany().HasForeignKey(p => p.FromSuggestionId)
            .OnDelete(DeleteBehavior.SetNull);
        // PRP-6 swapped this 2-way CHECK → 3-way (exactly one of
        // {target_share_token, target_published_track, target_version_id}) — the
        // legacy /share rows (target_share_token set) stay valid. Mirrors the
        // PRP-3 swap on track_comments.
        builder.Entity<TrackBookmark>().ToTable(t => t.HasCheckConstraint(
            "ck_track_bookmarks_one_target",
            "(CASE WHEN target_share_token IS NOT NULL THEN 1 ELSE 0 END "
            + "+ CASE WHEN target_published_track IS NOT NULL THEN 1 ELSE 0 END "
            + "+ CASE WHEN target_version_id IS NOT NULL THEN 1 ELSE 0 END) = 1"));
        builder.Entity<TrackBookmark>().HasIndex(b => b.TargetVersionId)
            .HasDatabaseName("ix_track_bookmarks_target_version_id");
        builder.Entity<TrackBookmark>()
            .HasOne<SongVersion>().WithMany().HasForeignKey(b => b.TargetVersionId)
            .OnDelete(DeleteBehavior.Cascade);

        // Notifications inbox (story 11.6): recipient-scoped list ordered by
        // updated_at; FK cascade cleans the inbox with the user. The DIGEST
        // uniqueness (partial unique on digest_key WHERE digest_key IS NOT NULL)
        // is raw SQL appended to the migration — EF can't express it fluently
        // here without also filtering event rows (digest_key NULL is exempt).
        builder.Entity<Notification>().HasIndex(n => new { n.RecipientUserId, n.UpdatedAt })
            .HasDatabaseName("ix_notifications_recipient_updated");
        builder.Entity<Notification>()
            .HasOne<User>().WithMany().HasForeignKey(n => n.RecipientUserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Follow graph (story 11.9): idempotent Follow via the unique pair;
        // followee index serves follower-count + feed fan-in reads; CHECK
        // rejects self-follows at the storage layer too.
        builder.Entity<FollowRelation>().HasIndex(f => new { f.FollowerId, f.FolloweeId })
            .IsUnique().HasDatabaseName("ux_follow_relations_pair");
        builder.Entity<FollowRelation>().HasIndex(f => f.FolloweeId)
            .HasDatabaseName("ix_follow_relations_followee");
        builder.Entity<FollowRelation>().ToTable(t => t.HasCheckConstraint(
            "ck_follow_relations_no_self", "follower_id <> followee_id"));
        builder.Entity<FollowRelation>()
            .HasOne<User>().WithMany().HasForeignKey(f => f.FollowerId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Entity<FollowRelation>()
            .HasOne<User>().WithMany().HasForeignKey(f => f.FolloweeId)
            .OnDelete(DeleteBehavior.Cascade);

        // Indexes for hot read paths
        builder.Entity<Analysis>().HasIndex(a => a.UserId);
        builder.Entity<Analysis>().HasIndex(a => a.VersionId);
        builder.Entity<Verdict>().HasIndex(v => v.AnalysisId);
        builder.Entity<Verdict>().HasIndex(v => new { v.AnalysisId, v.Specialist });
        // Problem-tier (IDENTIFY) defaults — backfill legacy rows + safety net for
        // any insert that doesn't set them (the worker sets them explicitly).
        builder.Entity<Verdict>().Property(v => v.Kind).HasDefaultValue("fault");
        builder.Entity<Verdict>().Property(v => v.Source).HasDefaultValue("rule_engine");
        builder.Entity<Verdict>().Property(v => v.DataTier).HasDefaultValue("audio_only");
        builder.Entity<Verdict>().Property(v => v.Fixable).HasDefaultValue(true);
        builder.Entity<Verdict>().Property(v => v.Suspected).HasDefaultValue(false);
        builder.Entity<AnalysisJob>().HasIndex(j => new { j.UserId, j.Status });
        // LLM spend dashboards (Epic 10) query by time and by user.
        builder.Entity<LlmCall>().HasIndex(c => c.CreatedAt);
        builder.Entity<LlmCall>().HasIndex(c => new { c.UserId, c.CreatedAt });
        builder.Entity<SessionNote>().HasIndex(n => new { n.VersionId, n.UserId });
        // Story 1.5: coach polling reads messages by conversation in order.
        // Note: an analysis-id-only index is redundant — the unique compound
        // index uq_conversations_analysis_user already serves as a prefix
        // index on (analysis_id), so single-column lookups by analysis_id
        // use it. We only declare the user_id single-column index and the
        // (conversation_id, created_at) ordering index. (Code review E-M3.)
        builder.Entity<Conversation>().HasIndex(c => c.UserId);
        builder.Entity<CoachMessage>().HasIndex(m => new { m.ConversationId, m.CreatedAt })
            .HasDatabaseName("ix_coach_messages_conversation_created_at");
        builder.Entity<TrackComment>().HasIndex(c => c.TargetShareToken);
        builder.Entity<TrackBookmark>().HasIndex(b => b.UserId);

        // Story 2.1 — billing tables.
        // subscriptions: keyed by user_id (1:1 mirror per architecture D2).
        builder.Entity<Subscription>().HasKey(s => s.UserId);
        builder.Entity<Subscription>()
            .HasIndex(s => s.StripeCustomerId).IsUnique()
            .HasDatabaseName("uq_subscriptions_stripe_customer_id");
        builder.Entity<Subscription>()
            .HasIndex(s => s.StripeSubscriptionId).IsUnique()
            .HasDatabaseName("uq_subscriptions_stripe_subscription_id");
        builder.Entity<Subscription>().Property(s => s.CreatedAt).HasDefaultValueSql("now()");
        builder.Entity<Subscription>().Property(s => s.UpdatedAt).HasDefaultValueSql("now()");

        // webhook_events: Stripe event.id PK (string), AR11 idempotency.
        builder.Entity<WebhookEvent>().HasKey(w => w.Id);
        builder.Entity<WebhookEvent>().Property(w => w.ReceivedAt).HasDefaultValueSql("now()");
        // Triage queries: "what failed to process recently"
        builder.Entity<WebhookEvent>().HasIndex(w => w.ReceivedAt);

        // User.StripeCustomerId — partial unique index added via raw SQL in
        // the migration Up() since EF can't fluently express partial-where.

        // Story 2.3 — credit_ledger + usage_events (append-only).
        builder.Entity<CreditLedgerEntry>().HasKey(e => e.Id);
        builder.Entity<CreditLedgerEntry>().Property(e => e.CreatedAt).HasDefaultValueSql("now()");
        // CHECK constraints: enum-as-string for reason; amount nonzero.
        builder.Entity<CreditLedgerEntry>().ToTable(t => t.HasCheckConstraint(
            "ck_credit_ledger_reason",
            "\"reason\" IN ('purchase','spend','reversal','adjustment')"));
        builder.Entity<CreditLedgerEntry>().ToTable(t => t.HasCheckConstraint(
            "ck_credit_ledger_amount_nonzero", "\"amount\" <> 0"));
        // Hot path: balance = SUM(amount) WHERE user_id = ?; ledger
        // pagination = ORDER BY created_at DESC. Composite index covers both.
        builder.Entity<CreditLedgerEntry>()
            .HasIndex(e => new { e.UserId, e.CreatedAt })
            .HasDatabaseName("ix_credit_ledger_user_created");
        // Partial unique index on idempotency_key — raw SQL in the
        // migration Up() (EF can't express partial-where fluently).

        builder.Entity<UsageEvent>().HasKey(e => e.Id);
        builder.Entity<UsageEvent>().Property(e => e.OccurredAt).HasDefaultValueSql("now()");
        builder.Entity<UsageEvent>().ToTable(t => t.HasCheckConstraint(
            "ck_usage_events_type",
            "\"event_type\" IN ('analysis','coach_message')"));
        // Story 2.4 entitlement rollup queries by (user, billing_period).
        builder.Entity<UsageEvent>()
            .HasIndex(e => new { e.UserId, e.BillingPeriod })
            .HasDatabaseName("ix_usage_events_user_period");

        // Story 2.4 — feature_flags: string PK, DB-side updated_at default.
        builder.Entity<FeatureFlag>().HasKey(f => f.Name);
        builder.Entity<FeatureFlag>().Property(f => f.UpdatedAt).HasDefaultValueSql("now()");

        // Personal score — one rating per (user, version).
        builder.Entity<VersionUserRating>()
            .HasIndex(r => new { r.UserId, r.VersionId }).IsUnique();
        builder.Entity<VersionUserRating>().Property(r => r.UpdatedAt).HasDefaultValueSql("now()");

        // Compare notes — one note per (user, normalized version pair).
        // Pair is stored normalized (version_a_id < version_b_id by Guid ordinal)
        // so reading/writing with A↔B reversed always hits the same row.
        builder.Entity<VersionCompareNote>()
            .HasIndex(n => new { n.UserId, n.VersionAId, n.VersionBId }).IsUnique();
        builder.Entity<VersionCompareNote>().Property(n => n.UpdatedAt).HasDefaultValueSql("now()");

        // Song tags — no duplicate tag name per (song, user); fast lookup by song.
        builder.Entity<SongTag>()
            .HasIndex(t => new { t.SongId, t.UserId, t.Name })
            .IsUnique()
            .HasDatabaseName("uq_song_tags_song_user_name");
        builder.Entity<SongTag>().HasIndex(t => t.SongId)
            .HasDatabaseName("ix_song_tags_song_id");
        builder.Entity<SongTag>().Property(t => t.CreatedAt).HasDefaultValueSql("now()");
        // FK → songs with cascade delete so tags don't orphan when a song is removed.
        builder.Entity<SongTag>()
            .HasOne<Song>()
            .WithMany()
            .HasForeignKey(t => t.SongId)
            .OnDelete(DeleteBehavior.Cascade);

        // Listen V3 (PRP-1) — rack presets/drafts + viz presets.
        // rack_presets/rack_drafts are VERSION-scoped (owner derives via
        // song_version -> song -> user; NO user_id). viz_presets are user-scoped.
        builder.Entity<RackPreset>().ToTable(t => t.HasCheckConstraint(
            "ck_rack_presets_source", "\"source\" IN ('user','coach','analysis')"));
        builder.Entity<RackPreset>().Property(p => p.Source).HasDefaultValue("user");
        builder.Entity<RackPreset>().HasIndex(p => p.SongVersionId)
            .HasDatabaseName("ix_rack_presets_song_version_id");
        builder.Entity<RackPreset>().Property(p => p.CreatedAt).HasDefaultValueSql("now()");
        builder.Entity<RackPreset>().Property(p => p.UpdatedAt).HasDefaultValueSql("now()");
        builder.Entity<RackPreset>()
            .HasOne<SongVersion>().WithMany().HasForeignKey(p => p.SongVersionId)
            .OnDelete(DeleteBehavior.Cascade);

        // One autosaved draft per version — UNIQUE(song_version_id).
        builder.Entity<RackDraft>().HasIndex(d => d.SongVersionId).IsUnique()
            .HasDatabaseName("uq_rack_drafts_song_version_id");
        builder.Entity<RackDraft>().Property(d => d.UpdatedAt).HasDefaultValueSql("now()");
        builder.Entity<RackDraft>()
            .HasOne<SongVersion>().WithMany().HasForeignKey(d => d.SongVersionId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<VizPreset>().HasIndex(v => v.UserId)
            .HasDatabaseName("ix_viz_presets_user_id");
        builder.Entity<VizPreset>().Property(v => v.CreatedAt).HasDefaultValueSql("now()");
        builder.Entity<VizPreset>().Property(v => v.UpdatedAt).HasDefaultValueSql("now()");
        builder.Entity<VizPreset>()
            .HasOne<User>().WithMany().HasForeignKey(v => v.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Listen V3 (PRP-2) — version-scoped sharing. ADDITIVE: the analysis-scoped
        // share (analyses.share_token) is untouched. share_settings is 1:1 with a
        // version (PK = song_version_id, mirrors Subscription). share_token uses a
        // PLAIN unique index — Postgres treats NULLs as distinct, so many private
        // (null-token) rows coexist while non-null tokens stay unique (same as
        // analyses.share_token above).
        builder.Entity<ShareSetting>().HasKey(s => s.SongVersionId);
        builder.Entity<ShareSetting>().ToTable(t =>
        {
            t.HasCheckConstraint("ck_share_settings_visibility",
                "\"visibility\" IN ('private','unlisted','public')");
            t.HasCheckConstraint("ck_share_settings_comments_policy",
                "\"comments_policy\" IN ('off','link','named')");
            t.HasCheckConstraint("ck_share_settings_host_policy",
                "\"session_host_policy\" IN ('owner_only','invited')");
            t.HasCheckConstraint("ck_share_settings_join_policy",
                "\"session_join_policy\" IN ('invited','link','public')");
        });
        builder.Entity<ShareSetting>().HasIndex(s => s.ShareToken).IsUnique()
            .HasDatabaseName("uq_share_settings_share_token");
        builder.Entity<ShareSetting>().Property(s => s.CreatedAt).HasDefaultValueSql("now()");
        builder.Entity<ShareSetting>().Property(s => s.UpdatedAt).HasDefaultValueSql("now()");
        builder.Entity<ShareSetting>()
            .HasOne<SongVersion>().WithMany().HasForeignKey(s => s.SongVersionId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Entity<Invite>().ToTable(t =>
        {
            t.HasCheckConstraint("ck_invites_scope", "\"scope\" IN ('version','session')");
            t.HasCheckConstraint("ck_invites_role", "\"role\" IN ('reviewer','listener','host')");
            t.HasCheckConstraint("ck_invites_status", "\"status\" IN ('pending','accepted','revoked')");
        });
        builder.Entity<Invite>().HasIndex(i => i.Token).IsUnique()
            .HasDatabaseName("uq_invites_token");
        builder.Entity<Invite>().HasIndex(i => i.SongVersionId)
            .HasDatabaseName("ix_invites_song_version_id");
        builder.Entity<Invite>().HasIndex(i => i.InvitedUserId)
            .HasDatabaseName("ix_invites_invited_user_id");
        builder.Entity<Invite>().Property(i => i.CreatedAt).HasDefaultValueSql("now()");
        builder.Entity<Invite>()
            .HasOne<SongVersion>().WithMany().HasForeignKey(i => i.SongVersionId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Entity<Invite>()
            .HasOne<User>().WithMany().HasForeignKey(i => i.CreatedBy)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Entity<Invite>()
            .HasOne<User>().WithMany().HasForeignKey(i => i.InvitedUserId)
            .OnDelete(DeleteBehavior.SetNull);

        // Listen V3 (PRP-4) — room sessions + control grants. JSON-first:
        // listening_sessions holds events_json/recap_json (no row-per-event).
        builder.Entity<ListeningSession>().ToTable(t => t.HasCheckConstraint(
            "ck_listening_sessions_status", "\"status\" IN ('live','ended')"));
        builder.Entity<ListeningSession>().Property(s => s.StartedAt).HasDefaultValueSql("now()");
        builder.Entity<ListeningSession>().HasIndex(s => s.SongVersionId)
            .HasDatabaseName("ix_listening_sessions_song_version_id");
        builder.Entity<ListeningSession>().HasIndex(s => s.HostId)
            .HasDatabaseName("ix_listening_sessions_host_id");
        builder.Entity<ListeningSession>().HasIndex(s => s.Status)
            .HasDatabaseName("ix_listening_sessions_status");
        // Story 11.10 — the activity-feed recap query: filter host_id +
        // recap_published_at IS NOT NULL, ordered recap_published_at DESC.
        // Partial: only published sessions are ever feed-visible.
        builder.Entity<ListeningSession>().HasIndex(s => new { s.HostId, s.RecapPublishedAt })
            .HasDatabaseName("ix_listening_sessions_host_recap_published")
            .HasFilter("recap_published_at IS NOT NULL");
        builder.Entity<ListeningSession>()
            .HasOne<SongVersion>().WithMany().HasForeignKey(s => s.SongVersionId)
            .OnDelete(DeleteBehavior.Cascade);
        // host_id → users: Postgres permits multiple cascade FK paths (the
        // user→song→version→session path also reaches this row), so Cascade
        // is safe and means deleting a host removes their hosted sessions.
        builder.Entity<ListeningSession>()
            .HasOne<User>().WithMany().HasForeignKey(s => s.HostId)
            .OnDelete(DeleteBehavior.Cascade);

        // control_grants — the provenance backbone. ONE active holder per
        // (session, scope) enforced by a partial-unique index added via raw SQL
        // in the migration (EF can't express the WHERE-clause fluently).
        builder.Entity<ControlGrant>().ToTable(t => t.HasCheckConstraint(
            "ck_control_grants_scope", "\"scope\" IN ('rack','visuals')"));
        builder.Entity<ControlGrant>().Property(g => g.GrantedAt).HasDefaultValueSql("now()");
        builder.Entity<ControlGrant>().HasIndex(g => g.SessionId)
            .HasDatabaseName("ix_control_grants_session_id");
        builder.Entity<ControlGrant>()
            .HasOne<ListeningSession>().WithMany().HasForeignKey(g => g.SessionId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Entity<ControlGrant>()
            .HasOne<User>().WithMany().HasForeignKey(g => g.GranteeUserId)
            .OnDelete(DeleteBehavior.SetNull);
        builder.Entity<ControlGrant>()
            .HasOne<User>().WithMany().HasForeignKey(g => g.GrantedBy)
            .OnDelete(DeleteBehavior.Cascade);

        // The 3 provenance FKs now that the target tables exist (columns were
        // nullable uuids from PRP-1/3). SetNull on delete — deleting a session
        // or grant must never delete a producer's adopted preset / suggestion;
        // it only severs the credit-chain pointer (mirrors from_suggestion_id).
        builder.Entity<RackPreset>()
            .HasOne<ListeningSession>().WithMany().HasForeignKey(p => p.CreatedInSessionId)
            .OnDelete(DeleteBehavior.SetNull);
        builder.Entity<RackPreset>()
            .HasOne<ControlGrant>().WithMany().HasForeignKey(p => p.ViaGrantId)
            .OnDelete(DeleteBehavior.SetNull);
        builder.Entity<ReviewerSuggestion>()
            .HasOne<ListeningSession>().WithMany().HasForeignKey(s => s.CreatedInSessionId)
            .OnDelete(DeleteBehavior.SetNull);

        // DB-side defaults for *_at timestamp columns.
        // Without these, inserts from outside EF (the Python worker via SQLAlchemy)
        // hit NotNullViolation since the C#-side `= DateTimeOffset.UtcNow` defaults
        // only fire when EF is the inserter. now() in Postgres returns
        // `timestamptz`, which matches our `DateTimeOffset` column type.
        builder.Entity<User>().Property(u => u.CreatedAt).HasDefaultValueSql("now()");
        builder.Entity<RefreshToken>().Property(t => t.CreatedAt).HasDefaultValueSql("now()");
        builder.Entity<Song>().Property(s => s.CreatedAt).HasDefaultValueSql("now()");
        builder.Entity<Song>().Property(s => s.UpdatedAt).HasDefaultValueSql("now()");
        // Per-song visibility — NOT NULL, DB default 'private' so existing rows
        // backfill and direct/worker inserts can't hit a NOT NULL violation.
        builder.Entity<Song>().Property(s => s.Visibility).HasDefaultValue("private");
        builder.Entity<SongVersion>().Property(v => v.CreatedAt).HasDefaultValueSql("now()");
        builder.Entity<SongVersion>().Property(v => v.UpdatedAt).HasDefaultValueSql("now()");
        builder.Entity<AnalysisJob>().Property(j => j.DispatchedAt).HasDefaultValueSql("now()");
        builder.Entity<Analysis>().Property(a => a.CreatedAt).HasDefaultValueSql("now()");
        builder.Entity<Verdict>().Property(v => v.CreatedAt).HasDefaultValueSql("now()");
        builder.Entity<VerdictUserState>().Property(s => s.CreatedAt).HasDefaultValueSql("now()");
        builder.Entity<VerdictUserState>().Property(s => s.UpdatedAt).HasDefaultValueSql("now()");
        builder.Entity<PromptVersion>().Property(p => p.UpdatedAt).HasDefaultValueSql("now()");
        builder.Entity<LlmCall>().Property(c => c.CreatedAt).HasDefaultValueSql("now()");
        builder.Entity<Conversation>().Property(c => c.CreatedAt).HasDefaultValueSql("now()");
        builder.Entity<CoachMessage>().Property(m => m.CreatedAt).HasDefaultValueSql("now()");
        // DB-side defaults so a direct/partial insert (outside the worker's
        // SQLAlchemy client-side defaults) can't hit a NOT NULL violation.
        builder.Entity<LlmCall>().Property(c => c.InputTokens).HasDefaultValue(0);
        builder.Entity<LlmCall>().Property(c => c.OutputTokens).HasDefaultValue(0);
        builder.Entity<LlmCall>().Property(c => c.CostUsd).HasDefaultValue(0m);
        builder.Entity<SessionNote>().Property(n => n.CreatedAt).HasDefaultValueSql("now()");
        builder.Entity<SessionNote>().Property(n => n.UpdatedAt).HasDefaultValueSql("now()");
        builder.Entity<ReferenceTrack>().Property(r => r.CreatedAt).HasDefaultValueSql("now()");
        builder.Entity<ReferenceSet>().Property(s => s.CreatedAt).HasDefaultValueSql("now()");
        builder.Entity<ReferenceSetMember>().Property(m => m.CreatedAt).HasDefaultValueSql("now()");
        builder.Entity<CompareCache>().Property(c => c.CreatedAt).HasDefaultValueSql("now()");
        builder.Entity<TrackComment>().Property(c => c.CreatedAt).HasDefaultValueSql("now()");
        builder.Entity<TrackBookmark>().Property(b => b.CreatedAt).HasDefaultValueSql("now()");

        base.OnModelCreating(builder);
    }
}
