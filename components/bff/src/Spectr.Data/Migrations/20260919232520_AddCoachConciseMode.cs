using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCoachConciseMode : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_coach_messages_mode",
                table: "coach_messages");

            migrationBuilder.AddCheckConstraint(
                name: "ck_coach_messages_mode",
                table: "coach_messages",
                sql: "\"mode\" IN ('qa','teach','concise')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Backfill any 'concise' rows to 'qa' BEFORE restoring the
            // 2-value check — restoring the check first would reject the
            // migration on any DB that already has concise-mode rows.
            migrationBuilder.Sql(
                "UPDATE coach_messages SET mode = 'qa' WHERE mode = 'concise';");

            migrationBuilder.DropCheckConstraint(
                name: "ck_coach_messages_mode",
                table: "coach_messages");

            migrationBuilder.AddCheckConstraint(
                name: "ck_coach_messages_mode",
                table: "coach_messages",
                sql: "\"mode\" IN ('qa','teach')");
        }
    }
}
