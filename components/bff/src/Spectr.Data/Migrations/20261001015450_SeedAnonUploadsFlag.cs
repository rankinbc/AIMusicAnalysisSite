using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class SeedAnonUploadsFlag : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Fix wave FW2 (final review M4) — the unused anonymous upload
            // (POST /api/anon/analyses) is OFF unless this reads 'true'.
            // Idempotent seed of a NEW name; never overwrites live tuning.
            migrationBuilder.Sql("""
                INSERT INTO feature_flags (name, value, updated_at) VALUES
                    ('anon_uploads_enabled', 'false', now())
                ON CONFLICT (name) DO NOTHING;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DELETE FROM feature_flags WHERE name IN ('anon_uploads_enabled');
                """);
        }
    }
}
