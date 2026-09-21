using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class SeedGuestCapFlags : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Task D6 fix round 1 — seeds the two new guest abuse-cap knobs:
            // guest_fix_racks_max (item 2, fix-rack generations per guest)
            // and guest_analyses_per_ip_hourly (item 4, the per-IP analysis
            // arm checked before the global guest-lane arm). Idempotent
            // (2.6 seeding precedent), same shape as 20260921023047_SeedDemoFlags.
            migrationBuilder.Sql("""
                INSERT INTO feature_flags (name, value, updated_at) VALUES
                    ('guest_fix_racks_max',            '2', now()),
                    ('guest_analyses_per_ip_hourly',   '2', now())
                ON CONFLICT (name) DO NOTHING;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DELETE FROM feature_flags WHERE name IN (
                    'guest_fix_racks_max', 'guest_analyses_per_ip_hourly');
                """);
        }
    }
}
