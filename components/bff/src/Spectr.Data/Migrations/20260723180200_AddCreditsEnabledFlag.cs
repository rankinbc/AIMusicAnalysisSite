using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCreditsEnabledFlag : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // credits_enabled — kill switch for the whole credit system.
            // 'false' ⇒ EntitlementService resolves everyone as premium
            // (unlimited analyses/coach, all feature bits). Missing row is
            // treated as 'true' (credits on) by the readers; seeded 'false'
            // because credits are switched off at launch. Idempotent
            // (2.6 seeding precedent).
            migrationBuilder.Sql("""
                INSERT INTO feature_flags (name, value, updated_at)
                VALUES ('credits_enabled', 'false', now())
                ON CONFLICT (name) DO NOTHING;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DELETE FROM feature_flags WHERE name = 'credits_enabled';
                """);
        }
    }
}
