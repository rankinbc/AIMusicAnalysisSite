using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddVerdictProblemFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "data_tier",
                table: "verdicts",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "audio_only");

            migrationBuilder.AddColumn<bool>(
                name: "fixable",
                table: "verdicts",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "kind",
                table: "verdicts",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "fault");

            migrationBuilder.AddColumn<string>(
                name: "problem_id",
                table: "verdicts",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "refines",
                table: "verdicts",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "source",
                table: "verdicts",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "rule_engine");

            migrationBuilder.AddColumn<bool>(
                name: "suspected",
                table: "verdicts",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "where",
                table: "verdicts",
                type: "jsonb",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "data_tier",
                table: "verdicts");

            migrationBuilder.DropColumn(
                name: "fixable",
                table: "verdicts");

            migrationBuilder.DropColumn(
                name: "kind",
                table: "verdicts");

            migrationBuilder.DropColumn(
                name: "problem_id",
                table: "verdicts");

            migrationBuilder.DropColumn(
                name: "refines",
                table: "verdicts");

            migrationBuilder.DropColumn(
                name: "source",
                table: "verdicts");

            migrationBuilder.DropColumn(
                name: "suspected",
                table: "verdicts");

            migrationBuilder.DropColumn(
                name: "where",
                table: "verdicts");
        }
    }
}
