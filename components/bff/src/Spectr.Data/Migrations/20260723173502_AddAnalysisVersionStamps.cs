using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddAnalysisVersionStamps : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "pipeline_version",
                table: "analyses",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "prompt_set_version",
                table: "analyses",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "rule_engine_version",
                table: "analyses",
                type: "character varying(60)",
                maxLength: 60,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "validator_version",
                table: "analyses",
                type: "character varying(60)",
                maxLength: 60,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "pipeline_version",
                table: "analyses");

            migrationBuilder.DropColumn(
                name: "prompt_set_version",
                table: "analyses");

            migrationBuilder.DropColumn(
                name: "rule_engine_version",
                table: "analyses");

            migrationBuilder.DropColumn(
                name: "validator_version",
                table: "analyses");
        }
    }
}
