using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class ReferenceProfiles : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "analysis_error",
                table: "reference_tracks",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "analysis_status",
                table: "reference_tracks",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "pending");

            migrationBuilder.AddColumn<string>(
                name: "profile_fingerprint",
                table: "reference_sets",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "profile_json",
                table: "reference_sets",
                type: "jsonb",
                nullable: true);

            // Backfill: existing analyzed rows are 'analyzed', the rest 'pending'.
            migrationBuilder.Sql(
                "UPDATE reference_tracks SET analysis_status = CASE WHEN analyzed THEN 'analyzed' ELSE 'pending' END;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "analysis_error",
                table: "reference_tracks");

            migrationBuilder.DropColumn(
                name: "analysis_status",
                table: "reference_tracks");

            migrationBuilder.DropColumn(
                name: "profile_fingerprint",
                table: "reference_sets");

            migrationBuilder.DropColumn(
                name: "profile_json",
                table: "reference_sets");
        }
    }
}
