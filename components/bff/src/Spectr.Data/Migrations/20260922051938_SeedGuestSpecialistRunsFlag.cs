using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class SeedGuestSpecialistRunsFlag : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Fix wave FW1 (final review C1) — on-demand specialist runs had
            // no per-guest cap. Plain idempotent seed of a NEW name; nothing
            // here overwrites an operator's live tuning. Read by
            // GuestLimits.CheckSpecialistRunAsync (code default: 12).
            migrationBuilder.Sql("""
                INSERT INTO feature_flags (name, value, updated_at) VALUES
                    ('guest_specialist_runs_max', '12', now())
                ON CONFLICT (name) DO NOTHING;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DELETE FROM feature_flags WHERE name IN ('guest_specialist_runs_max');
                """);
        }
    }
}
