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

    // References + Compare
    public DbSet<ReferenceTrack> ReferenceTracks => Set<ReferenceTrack>();
    public DbSet<ReferenceSet> ReferenceSets => Set<ReferenceSet>();
    public DbSet<ReferenceSetMember> ReferenceSetMembers => Set<ReferenceSetMember>();
    public DbSet<CompareCache> CompareCaches => Set<CompareCache>();

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

    // Email suppression list (story 4.2 — bounce/complaint webhook appends)
    public DbSet<EmailSuppression> EmailSuppressions => Set<EmailSuppression>();

    // Single-use auth tokens: email verification + password reset (story 4.3)
    public DbSet<AuthToken> AuthTokens => Set<AuthToken>();

    // Anonymous device identities (story 4.5 — AR24/AR25)
    public DbSet<Device> Devices => Set<Device>();

    // Append-only audit trail (story 4.6 first writer; 10.5 extends)
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        builder.HasPostgresExtension("pgcrypto");      // gen_random_uuid()
        builder.HasPostgresExtension("citext");         // case-insensitive email/handle

        // Case-insensitive identity columns (citext on Postgres).
        builder.Entity<User>().Property(u => u.Email).HasColumnType("citext");

        // Composite keys
        builder.Entity<VerdictUserState>()
            .HasKey(s => new { s.VerdictId, s.UserId });
        builder.Entity<ReferenceSetMember>()
            .HasKey(m => new { m.SetId, m.ReferenceId });

        // Uniqueness
        builder.Entity<User>()
            .HasIndex(u => u.Email).IsUnique();
        builder.Entity<Song>()
            .HasIndex(s => new { s.UserId, s.Name }).IsUnique()
            .HasDatabaseName("uq_songs_user_name");
        builder.Entity<SongVersion>()
            .HasIndex(v => new { v.SongId, v.VersionNumber }).IsUnique()
            .HasDatabaseName("uq_song_versions_song_number");
        builder.Entity<Analysis>()
            .HasIndex(a => a.JobId).IsUnique();
        // Story 4.3: token lookup is by hash; unique doubles as the guard
        // against a (vanishingly unlikely) duplicate raw token.
        builder.Entity<AuthToken>()
            .HasIndex(t => t.TokenHash).IsUnique();
        builder.Entity<AuthToken>()
            .HasIndex(t => new { t.UserId, t.Purpose });
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
        // Story 5.7 — once-only free retry is enforced AT THE DATABASE: a
        // partial unique index makes the concurrent double-POST race lose at
        // commit (DbUpdateException → 409), not at a read-then-insert check
        // (review finding: check-then-insert alone mints N free retries).
        builder.Entity<AnalysisJob>().HasIndex(j => j.RetryOfJobId)
            .IsUnique()
            .HasFilter("retry_of_job_id IS NOT NULL");
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

        // DB-side defaults for *_at timestamp columns.
        // Without these, inserts from outside EF (the Python worker via SQLAlchemy)
        // hit NotNullViolation since the C#-side `= DateTimeOffset.UtcNow` defaults
        // only fire when EF is the inserter. now() in Postgres returns
        // `timestamptz`, which matches our `DateTimeOffset` column type.
        builder.Entity<User>().Property(u => u.CreatedAt).HasDefaultValueSql("now()");
        builder.Entity<RefreshToken>().Property(t => t.CreatedAt).HasDefaultValueSql("now()");
        builder.Entity<Song>().Property(s => s.CreatedAt).HasDefaultValueSql("now()");
        builder.Entity<Song>().Property(s => s.UpdatedAt).HasDefaultValueSql("now()");
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

        base.OnModelCreating(builder);
    }
}
