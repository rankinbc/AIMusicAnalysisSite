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

    // References + Compare
    public DbSet<ReferenceTrack> ReferenceTracks => Set<ReferenceTrack>();
    public DbSet<ReferenceSet> ReferenceSets => Set<ReferenceSet>();
    public DbSet<ReferenceSetMember> ReferenceSetMembers => Set<ReferenceSetMember>();
    public DbSet<CompareCache> CompareCaches => Set<CompareCache>();

    // Feedback (Phase 1.5)
    public DbSet<TrackComment> TrackComments => Set<TrackComment>();
    public DbSet<TrackBookmark> TrackBookmarks => Set<TrackBookmark>();

    // Billing (story 2.1)
    public DbSet<Subscription> Subscriptions => Set<Subscription>();
    public DbSet<WebhookEvent> WebhookEvents => Set<WebhookEvent>();

    // Billing (story 2.3 — append-only signed ledger + period usage log)
    public DbSet<CreditLedgerEntry> CreditLedger => Set<CreditLedgerEntry>();
    public DbSet<UsageEvent> UsageEvents => Set<UsageEvent>();

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

        // Polymorphic CHECKs on comments + bookmarks (exactly one target set).
        builder.Entity<TrackComment>().ToTable(t => t.HasCheckConstraint(
            "ck_track_comments_one_target",
            "(target_share_token IS NOT NULL AND target_published_track IS NULL) "
            + "OR (target_share_token IS NULL AND target_published_track IS NOT NULL)"));
        builder.Entity<TrackBookmark>().ToTable(t => t.HasCheckConstraint(
            "ck_track_bookmarks_one_target",
            "(target_share_token IS NOT NULL AND target_published_track IS NULL) "
            + "OR (target_share_token IS NULL AND target_published_track IS NOT NULL)"));

        // Indexes for hot read paths
        builder.Entity<Analysis>().HasIndex(a => a.UserId);
        builder.Entity<Analysis>().HasIndex(a => a.VersionId);
        builder.Entity<Verdict>().HasIndex(v => v.AnalysisId);
        builder.Entity<Verdict>().HasIndex(v => new { v.AnalysisId, v.Specialist });
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
        builder.Entity<TrackComment>().Property(c => c.CreatedAt).HasDefaultValueSql("now()");
        builder.Entity<TrackBookmark>().Property(b => b.CreatedAt).HasDefaultValueSql("now()");

        base.OnModelCreating(builder);
    }
}
