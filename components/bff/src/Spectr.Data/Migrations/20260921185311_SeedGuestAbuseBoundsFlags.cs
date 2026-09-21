using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class SeedGuestAbuseBoundsFlags : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Fix round 1 (Opus review of 665b39f + c78ee3d) — three routes a
            // guest can now reach had no abuse-bound cap of their own: stem
            // classification, reference re-analysis, and the presigned
            // attachment mint. Plain idempotent seed; nothing here overwrites
            // an operator's own live tuning (there is nothing to overwrite —
            // these three names are new).
            migrationBuilder.Sql("""
                INSERT INTO feature_flags (name, value, updated_at) VALUES
                    ('guest_classify_max',         '6',  now()),
                    ('guest_ref_analyze_max',      '3',  now()),
                    ('guest_attachment_mints_max', '30', now())
                ON CONFLICT (name) DO NOTHING;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DELETE FROM feature_flags WHERE name IN (
                    'guest_classify_max', 'guest_ref_analyze_max', 'guest_attachment_mints_max');
                """);
        }
    }
}
