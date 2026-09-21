using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class SeedGuestFirstUploadFlags : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Task G1 — the owner decision to give guests the real product
            // under caps instead of locks (spec G-D5/G-D7): stems, .als, a
            // reference track, delete/restore, and retry, all capped; guest
            // data now lives 24 hours (was 72). New knobs are a plain
            // idempotent seed; the three pre-existing knobs are guarded
            // UPDATEs so an operator's own live tuning is never overwritten
            // (only the value this task originally seeded is advanced).
            migrationBuilder.Sql("""
                INSERT INTO feature_flags (name, value, updated_at) VALUES
                    ('guest_analyses_max',      '6',   now()),
                    ('guest_stems_max_files',   '12',  now()),
                    ('guest_stems_max_mb',      '300', now()),
                    ('guest_references_max',    '1',   now()),
                    ('guest_track_max_seconds', '720', now())
                ON CONFLICT (name) DO NOTHING;
                """);
            migrationBuilder.Sql(
                "UPDATE feature_flags SET value = '24', updated_at = now() WHERE name = 'guest_ttl_hours' AND value = '72';");
            migrationBuilder.Sql(
                "UPDATE feature_flags SET value = '2', updated_at = now() WHERE name = 'guest_uploads_max' AND value = '1';");
            migrationBuilder.Sql(
                "UPDATE feature_flags SET value = '30', updated_at = now() WHERE name = 'llm_budget_guest_usd' AND value = '5';");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "UPDATE feature_flags SET value = '72', updated_at = now() WHERE name = 'guest_ttl_hours' AND value = '24';");
            migrationBuilder.Sql(
                "UPDATE feature_flags SET value = '1', updated_at = now() WHERE name = 'guest_uploads_max' AND value = '2';");
            migrationBuilder.Sql(
                "UPDATE feature_flags SET value = '5', updated_at = now() WHERE name = 'llm_budget_guest_usd' AND value = '30';");
            migrationBuilder.Sql("""
                DELETE FROM feature_flags WHERE name IN (
                    'guest_analyses_max', 'guest_stems_max_files', 'guest_stems_max_mb',
                    'guest_references_max', 'guest_track_max_seconds');
                """);
        }
    }
}
