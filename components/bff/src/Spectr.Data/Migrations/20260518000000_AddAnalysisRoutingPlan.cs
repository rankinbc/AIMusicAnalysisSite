using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <summary>
    /// Adds the nullable `routing_plan` JSONB column to `analyses`. Holds the
    /// Triage-step output produced by the Python `run_triage` actor —
    /// `{specialists_to_run, skip, rationale, estimated_total_tokens}`. Null
    /// until the BFF lazy-fires Triage on first ListVerdicts.
    /// </summary>
    public partial class AddAnalysisRoutingPlan : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "routing_plan",
                table: "analyses",
                type: "jsonb",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "routing_plan",
                table: "analyses");
        }
    }
}
