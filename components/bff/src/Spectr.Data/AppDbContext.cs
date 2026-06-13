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

        // Partial unique index — only ONE current version per song.
        // (raw SQL because EF Core doesn't expose partial-index DSL fluently for Postgres yet)
        builder.Entity<SongVersion>().ToTable(t => t.HasCheckConstraint(
            "ck_song_versions_version_positive", "\"version_number\" > 0"));

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
        builder.Entity<TrackComment>().HasIndex(c => c.TargetShareToken);
        builder.Entity<TrackBookmark>().HasIndex(b => b.UserId);

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
