using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddNotifications : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "notifications",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    recipient_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    event_type = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    payload = table.Column<string>(type: "jsonb", nullable: true),
                    digest_key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    count = table.Column<int>(type: "integer", nullable: false),
                    read_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_notifications", x => x.id);
                    table.ForeignKey(
                        name: "FK_notifications_users_recipient_user_id",
                        column: x => x.recipient_user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_notifications_recipient_updated",
                table: "notifications",
                columns: new[] { "recipient_user_id", "updated_at" });

            // Story 11.6 (AC1) — RAW SQL partial unique: digest rows are unique
            // per digest_key while event rows (digest_key NULL) are unlimited.
            // EF can't express a filtered unique index fluently here (same
            // manual-step pattern as the is_current index; see bff/README.md).
            // The TableNotificationSink upsert targets this index by name via
            // ON CONFLICT (digest_key) WHERE digest_key IS NOT NULL.
            migrationBuilder.Sql(
                "CREATE UNIQUE INDEX ux_notifications_digest_key ON notifications (digest_key) "
                + "WHERE digest_key IS NOT NULL;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP INDEX IF EXISTS ux_notifications_digest_key;");
            migrationBuilder.DropTable(
                name: "notifications");
        }
    }
}
