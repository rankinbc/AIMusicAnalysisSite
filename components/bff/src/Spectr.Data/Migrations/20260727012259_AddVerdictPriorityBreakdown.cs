using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddVerdictPriorityBreakdown : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "priority_base",
                table: "verdicts",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "priority_category_weight",
                table: "verdicts",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "priority_scope_multiplier",
                table: "verdicts",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "scope",
                table: "verdicts",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "priority_base",
                table: "verdicts");

            migrationBuilder.DropColumn(
                name: "priority_category_weight",
                table: "verdicts");

            migrationBuilder.DropColumn(
                name: "priority_scope_multiplier",
                table: "verdicts");

            migrationBuilder.DropColumn(
                name: "scope",
                table: "verdicts");
        }
    }
}
