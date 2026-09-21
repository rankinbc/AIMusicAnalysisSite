using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class SeedDemoFlags : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Guest demo sandbox (D1/§4) — kill switch + abuse/cost knobs for
            // the /api/auth/demo flow. demo_enabled seeds 'false': prod stays
            // off until a snapshot is installed. Idempotent (2.6 seeding
            // precedent).
            migrationBuilder.Sql("""
                INSERT INTO feature_flags (name, value, updated_at) VALUES
                    ('demo_enabled',                 'false', now()),
                    ('guest_ttl_hours',               '72',   now()),
                    ('demo_guests_per_ip_hourly',      '5',   now()),
                    ('demo_guests_daily_cap',          '300', now()),
                    ('guest_uploads_max',              '1',   now()),
                    ('guest_analyses_per_hour',        '10',  now()),
                    ('coach_guest_messages',           '20',  now()),
                    ('llm_budget_guest_usd',            '5',  now()),
                    ('anon_sample_per_hour_global',    '20',  now())
                ON CONFLICT (name) DO NOTHING;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DELETE FROM feature_flags WHERE name IN (
                    'demo_enabled', 'guest_ttl_hours', 'demo_guests_per_ip_hourly',
                    'demo_guests_daily_cap', 'guest_uploads_max', 'guest_analyses_per_hour',
                    'coach_guest_messages', 'llm_budget_guest_usd', 'anon_sample_per_hour_global');
                """);
        }
    }
}
