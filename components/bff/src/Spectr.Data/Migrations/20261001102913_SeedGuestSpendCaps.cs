using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class SeedGuestSpendCaps : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Guest abuse caps (2026-10). llm_budget_guest_session_usd: one
            // guest's lifetime AI spend (the worker's per-guest arm, so one
            // visitor can't drain the shared llm_budget_guest_usd pool).
            // demo_guests_per_ip_daily: the 24 h arm next to the hourly one.
            // Idempotent seed of NEW names; never overwrites live tuning.
            migrationBuilder.Sql("""
                INSERT INTO feature_flags (name, value, updated_at) VALUES
                    ('llm_budget_guest_session_usd', '1.50', now()),
                    ('demo_guests_per_ip_daily', '10', now())
                ON CONFLICT (name) DO NOTHING;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DELETE FROM feature_flags WHERE name IN ('llm_budget_guest_session_usd', 'demo_guests_per_ip_daily');
                """);
        }
    }
}
