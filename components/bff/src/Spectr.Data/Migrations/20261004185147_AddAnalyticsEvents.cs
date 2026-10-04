using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddAnalyticsEvents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "analytics_events",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    occurred_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    @event = table.Column<string>(name: "event", type: "character varying(48)", maxLength: 48, nullable: false),
                    session_id = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: true),
                    user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    path = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    props = table.Column<string>(type: "jsonb", nullable: true),
                    source = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    medium = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    campaign = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    referrer = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_analytics_events", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_analytics_events_occurred_event",
                table: "analytics_events",
                columns: new[] { "occurred_at", "event" });

            migrationBuilder.CreateIndex(
                name: "ix_analytics_events_user",
                table: "analytics_events",
                column: "user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "analytics_events");
        }
    }
}
