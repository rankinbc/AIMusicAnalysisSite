using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class Initial : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterDatabase()
                .Annotation("Npgsql:PostgresExtension:citext", ",,")
                .Annotation("Npgsql:PostgresExtension:pgcrypto", ",,");

            migrationBuilder.CreateTable(
                name: "analyses",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    job_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    version_id = table.Column<Guid>(type: "uuid", nullable: true),
                    song_id = table.Column<Guid>(type: "uuid", nullable: true),
                    song_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    final_json = table.Column<string>(type: "jsonb", nullable: false),
                    phase_durations = table.Column<string>(type: "jsonb", nullable: false),
                    waveform_peaks_path = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    stem_metrics = table.Column<string>(type: "jsonb", nullable: true),
                    share_token = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: true),
                    share_show_verdicts = table.Column<bool>(type: "boolean", nullable: false),
                    share_enabled_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_analyses", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "analysis_jobs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    version_id = table.Column<Guid>(type: "uuid", nullable: true),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    current_phase = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    phase_pct = table.Column<double>(type: "double precision", nullable: false),
                    reference_id = table.Column<Guid>(type: "uuid", nullable: true),
                    task_id = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    error_message = table.Column<string>(type: "text", nullable: true),
                    dispatched_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    started_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    completed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    failed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_analysis_jobs", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "compare_cache",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    track_version_id = table.Column<Guid>(type: "uuid", nullable: false),
                    reference_id = table.Column<Guid>(type: "uuid", nullable: false),
                    match_score = table.Column<int>(type: "integer", nullable: false),
                    sub_scores = table.Column<string>(type: "jsonb", nullable: false),
                    delta_metrics = table.Column<string>(type: "jsonb", nullable: false),
                    suggestions = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_compare_cache", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "reference_set_members",
                columns: table => new
                {
                    set_id = table.Column<Guid>(type: "uuid", nullable: false),
                    reference_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_reference_set_members", x => new { x.set_id, x.reference_id });
                });

            migrationBuilder.CreateTable(
                name: "reference_sets",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    hue = table.Column<short>(type: "smallint", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_reference_sets", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "reference_tracks",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    artist = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    source = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    source_url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    file_path = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    genre = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    bpm = table.Column<double>(type: "double precision", nullable: true),
                    detected_key = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true),
                    duration_seconds = table.Column<double>(type: "double precision", nullable: true),
                    lufs = table.Column<double>(type: "double precision", nullable: true),
                    true_peak_db = table.Column<double>(type: "double precision", nullable: true),
                    dynamic_range_lu = table.Column<double>(type: "double precision", nullable: true),
                    stereo_width = table.Column<double>(type: "double precision", nullable: true),
                    stereo_correlation = table.Column<double>(type: "double precision", nullable: true),
                    band_levels = table.Column<string>(type: "jsonb", nullable: true),
                    tags = table.Column<string>(type: "jsonb", nullable: false),
                    analyzed = table.Column<bool>(type: "boolean", nullable: false),
                    used_count = table.Column<int>(type: "integer", nullable: false),
                    notes = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_reference_tracks", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "refresh_tokens",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    token_hash = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    revoked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_refresh_tokens", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "session_notes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    version_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    t_seconds = table.Column<double>(type: "double precision", nullable: false),
                    text = table.Column<string>(type: "text", nullable: false),
                    pinned = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_session_notes", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "song_versions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    song_id = table.Column<Guid>(type: "uuid", nullable: false),
                    version_number = table.Column<int>(type: "integer", nullable: false),
                    label = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    notes = table.Column<string>(type: "text", nullable: true),
                    file_path = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    reference_path = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    als_file_path = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    stem_paths_raw = table.Column<string>(type: "jsonb", nullable: true),
                    stem_paths = table.Column<string>(type: "jsonb", nullable: true),
                    is_current = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_song_versions", x => x.id);
                    table.CheckConstraint("ck_song_versions_version_positive", "\"version_number\" > 0");
                });

            migrationBuilder.CreateTable(
                name: "songs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    genre_hint = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    default_reference_id = table.Column<Guid>(type: "uuid", nullable: true),
                    archived_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_songs", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "track_bookmarks",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    target_share_token = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: true),
                    target_published_track = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_track_bookmarks", x => x.id);
                    table.CheckConstraint("ck_track_bookmarks_one_target", "(target_share_token IS NOT NULL AND target_published_track IS NULL) OR (target_share_token IS NULL AND target_published_track IS NOT NULL)");
                });

            migrationBuilder.CreateTable(
                name: "track_comments",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    target_share_token = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: true),
                    target_published_track = table.Column<Guid>(type: "uuid", nullable: true),
                    author_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    author_display_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    author_ip_hash = table.Column<byte[]>(type: "bytea", nullable: true),
                    timestamp_seconds = table.Column<double>(type: "double precision", nullable: true),
                    body = table.Column<string>(type: "text", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_track_comments", x => x.id);
                    table.CheckConstraint("ck_track_comments_one_target", "(target_share_token IS NOT NULL AND target_published_track IS NULL) OR (target_share_token IS NULL AND target_published_track IS NOT NULL)");
                });

            migrationBuilder.CreateTable(
                name: "users",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    email = table.Column<string>(type: "citext", maxLength: 255, nullable: false),
                    hashed_password = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    handle = table.Column<string>(type: "citext", maxLength: 32, nullable: true),
                    display_name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    bio = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    avatar_hue = table.Column<short>(type: "smallint", nullable: true),
                    banner_hue = table.Column<short>(type: "smallint", nullable: true),
                    accent = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    public_link = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    ui_prefs = table.Column<string>(type: "jsonb", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_users", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "verdict_user_state",
                columns: table => new
                {
                    verdict_id = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    dismissed = table.Column<bool>(type: "boolean", nullable: false),
                    applied = table.Column<bool>(type: "boolean", nullable: false),
                    user_modified_fix = table.Column<string>(type: "jsonb", nullable: true),
                    feedback = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_verdict_user_state", x => new { x.verdict_id, x.user_id });
                });

            migrationBuilder.CreateTable(
                name: "verdicts",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    analysis_id = table.Column<Guid>(type: "uuid", nullable: false),
                    specialist = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    prompt_version = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    model = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    severity = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    category = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    confidence = table.Column<double>(type: "double precision", nullable: false),
                    priority_score = table.Column<int>(type: "integer", nullable: false),
                    impact = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    chart_type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    headline = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    summary = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: true),
                    body = table.Column<string>(type: "text", nullable: true),
                    metric_line = table.Column<string>(type: "character varying(240)", maxLength: 240, nullable: true),
                    why_it_matters = table.Column<string>(type: "character varying(280)", maxLength: 280, nullable: true),
                    preset_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    evidence = table.Column<string>(type: "jsonb", nullable: false),
                    fix = table.Column<string>(type: "jsonb", nullable: true),
                    sources = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_verdicts", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_analyses_job_id",
                table: "analyses",
                column: "job_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_analyses_share_token",
                table: "analyses",
                column: "share_token",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_analyses_user_id",
                table: "analyses",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_analyses_version_id",
                table: "analyses",
                column: "version_id");

            migrationBuilder.CreateIndex(
                name: "IX_analysis_jobs_user_id_status",
                table: "analysis_jobs",
                columns: new[] { "user_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_compare_cache_track_version_id_reference_id",
                table: "compare_cache",
                columns: new[] { "track_version_id", "reference_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_session_notes_version_id_user_id",
                table: "session_notes",
                columns: new[] { "version_id", "user_id" });

            migrationBuilder.CreateIndex(
                name: "uq_song_versions_song_number",
                table: "song_versions",
                columns: new[] { "song_id", "version_number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_songs_user_name",
                table: "songs",
                columns: new[] { "user_id", "name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_track_bookmarks_user_id",
                table: "track_bookmarks",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_track_comments_target_share_token",
                table: "track_comments",
                column: "target_share_token");

            migrationBuilder.CreateIndex(
                name: "IX_users_email",
                table: "users",
                column: "email",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_users_handle",
                table: "users",
                column: "handle",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_verdicts_analysis_id",
                table: "verdicts",
                column: "analysis_id");

            migrationBuilder.CreateIndex(
                name: "IX_verdicts_analysis_id_specialist",
                table: "verdicts",
                columns: new[] { "analysis_id", "specialist" });

            // Partial unique index — only ONE current version per song.
            // EF Core's fluent API doesn't express partial indexes for Postgres
            // so this is patched into the migration manually (see BFF README).
            migrationBuilder.Sql(@"
                CREATE UNIQUE INDEX uq_song_versions_one_current_per_song
                ON song_versions (song_id) WHERE is_current;
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP INDEX IF EXISTS uq_song_versions_one_current_per_song;");


            migrationBuilder.DropTable(
                name: "analyses");

            migrationBuilder.DropTable(
                name: "analysis_jobs");

            migrationBuilder.DropTable(
                name: "compare_cache");

            migrationBuilder.DropTable(
                name: "reference_set_members");

            migrationBuilder.DropTable(
                name: "reference_sets");

            migrationBuilder.DropTable(
                name: "reference_tracks");

            migrationBuilder.DropTable(
                name: "refresh_tokens");

            migrationBuilder.DropTable(
                name: "session_notes");

            migrationBuilder.DropTable(
                name: "song_versions");

            migrationBuilder.DropTable(
                name: "songs");

            migrationBuilder.DropTable(
                name: "track_bookmarks");

            migrationBuilder.DropTable(
                name: "track_comments");

            migrationBuilder.DropTable(
                name: "users");

            migrationBuilder.DropTable(
                name: "verdict_user_state");

            migrationBuilder.DropTable(
                name: "verdicts");
        }
    }
}
