using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddFeatureFlagsAndJobTier : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "tier",
                table: "analysis_jobs",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "feature_flags",
                columns: table => new
                {
                    name = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    value = table.Column<string>(type: "text", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_feature_flags", x => x.name);
                });

            // Seed initial operator flags — skip if already present (idempotent re-run).
            migrationBuilder.Sql(@"
                INSERT INTO feature_flags (name, value) VALUES
                    ('free_analyses_per_month', '3'),
                    ('coach_free_followups',    '3'),
                    ('history_depth_free',      '10'),
                    ('history_depth_credits',   '30')
                ON CONFLICT (name) DO NOTHING;
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "feature_flags");

            migrationBuilder.DropColumn(
                name: "tier",
                table: "analysis_jobs");
        }
    }
}
