using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCoachMessageMode : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "mode",
                table: "coach_messages",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "qa");

            migrationBuilder.AddCheckConstraint(
                name: "ck_coach_messages_mode",
                table: "coach_messages",
                sql: "\"mode\" IN ('qa','teach')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_coach_messages_mode",
                table: "coach_messages");

            migrationBuilder.DropColumn(
                name: "mode",
                table: "coach_messages");
        }
    }
}
