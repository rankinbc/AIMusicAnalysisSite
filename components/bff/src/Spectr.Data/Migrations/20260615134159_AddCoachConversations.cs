using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCoachConversations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "coach_messages",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    conversation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    role = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    content = table.Column<string>(type: "text", nullable: false),
                    evidence = table.Column<string>(type: "jsonb", nullable: true),
                    refusal_reason = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    llm_call_id = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    completed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_coach_messages", x => x.id);
                    table.CheckConstraint("ck_coach_messages_role", "\"role\" IN ('user','assistant')");
                    table.CheckConstraint("ck_coach_messages_status", "\"status\" IN ('pending','complete','refused','error')");
                });

            migrationBuilder.CreateTable(
                name: "conversations",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    analysis_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_conversations", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_coach_messages_conversation_created_at",
                table: "coach_messages",
                columns: new[] { "conversation_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_conversations_analysis_id",
                table: "conversations",
                column: "analysis_id");

            migrationBuilder.CreateIndex(
                name: "IX_conversations_user_id",
                table: "conversations",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "uq_conversations_analysis_user",
                table: "conversations",
                columns: new[] { "analysis_id", "user_id" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "coach_messages");

            migrationBuilder.DropTable(
                name: "conversations");
        }
    }
}
