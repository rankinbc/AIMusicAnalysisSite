using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class SeedAbuseFlags : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Story 10.6 (FR47) — abuse knobs, live-tunable via the 10.5
            // admin surface. Idempotent (2.6 seeding precedent).
            migrationBuilder.Sql("""
                INSERT INTO feature_flags (name, value, updated_at) VALUES
                    ('disposable_register_per_hour_ip', '2',  now()),
                    ('disposable_free_analyses',        '1',  now()),
                    ('dispatch_per_ip_hourly',          '10', now()),
                    ('disposable_extra_domains',        '',   now())
                ON CONFLICT (name) DO NOTHING;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DELETE FROM feature_flags WHERE name IN (
                    'disposable_register_per_hour_ip', 'disposable_free_analyses',
                    'dispatch_per_ip_hourly', 'disposable_extra_domains');
                """);
        }
    }
}
