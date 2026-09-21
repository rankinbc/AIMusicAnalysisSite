using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCoachBriefMode : Migration
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
                sql: "\"mode\" IN ('qa','teach','concise','brief')");

            // Task G3 — RAW SQL partial unique: EF can't express a filtered
            // unique index fluently (same manual-step pattern as the
            // is_current index and ux_notifications_digest_key; see
            // bff/README.md). At most one assistant brief row per
            // conversation — the BFF's idempotency guard relies on the
            // DB-level constraint under concurrent POST /brief.
            migrationBuilder.Sql(
                "CREATE UNIQUE INDEX ux_coach_messages_brief ON coach_messages (conversation_id) "
                + "WHERE mode = 'brief' AND role = 'assistant';");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP INDEX IF EXISTS ux_coach_messages_brief;");

            migrationBuilder.DropCheckConstraint(
                name: "ck_coach_messages_mode",
                table: "coach_messages");

            migrationBuilder.AddCheckConstraint(
                name: "ck_coach_messages_mode",
                table: "coach_messages",
                sql: "\"mode\" IN ('qa','teach','concise')");
        }
    }
}
