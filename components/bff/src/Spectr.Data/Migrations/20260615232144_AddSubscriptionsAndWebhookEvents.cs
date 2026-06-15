using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSubscriptionsAndWebhookEvents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "stripe_customer_id",
                table: "users",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "subscriptions",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    stripe_customer_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    stripe_subscription_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    status = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    price_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    current_period_end = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    cancel_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_subscriptions", x => x.user_id);
                });

            migrationBuilder.CreateTable(
                name: "webhook_events",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    event_type = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    payload_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    received_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    processed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    processing_error = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_webhook_events", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "uq_subscriptions_stripe_customer_id",
                table: "subscriptions",
                column: "stripe_customer_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_subscriptions_stripe_subscription_id",
                table: "subscriptions",
                column: "stripe_subscription_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_webhook_events_received_at",
                table: "webhook_events",
                column: "received_at");

            // Story 2.1 — partial unique index on users.stripe_customer_id
            // (only enforces uniqueness when the column is set). EF Core
            // can't fluently express partial-where indexes for Npgsql, so
            // we append the raw DDL here following the pattern documented
            // in components/bff/README.md "EF Core 10 migrations require a
            // manual partial-index step".
            migrationBuilder.Sql(
                "CREATE UNIQUE INDEX uq_users_stripe_customer_id "
                + "ON users (stripe_customer_id) "
                + "WHERE stripe_customer_id IS NOT NULL;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "DROP INDEX IF EXISTS uq_users_stripe_customer_id;");

            migrationBuilder.DropTable(
                name: "subscriptions");

            migrationBuilder.DropTable(
                name: "webhook_events");

            migrationBuilder.DropColumn(
                name: "stripe_customer_id",
                table: "users");
        }
    }
}
