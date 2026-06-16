using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCreditLedgerAndUsageEvents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "error_code",
                table: "analysis_jobs",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "credit_ledger",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    amount = table.Column<int>(type: "integer", nullable: false),
                    reason = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    reference = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    idempotency_key = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_credit_ledger", x => x.id);
                    table.CheckConstraint("ck_credit_ledger_amount_nonzero", "\"amount\" <> 0");
                    table.CheckConstraint("ck_credit_ledger_reason", "\"reason\" IN ('purchase','spend','reversal','adjustment')");
                });

            migrationBuilder.CreateTable(
                name: "usage_events",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    event_type = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    billing_period = table.Column<string>(type: "character varying(7)", maxLength: 7, nullable: false),
                    reference = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    occurred_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_usage_events", x => x.id);
                    table.CheckConstraint("ck_usage_events_type", "\"event_type\" IN ('analysis','coach_message')");
                });

            migrationBuilder.CreateIndex(
                name: "ix_credit_ledger_user_created",
                table: "credit_ledger",
                columns: new[] { "user_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_usage_events_user_period",
                table: "usage_events",
                columns: new[] { "user_id", "billing_period" });

            // Story 2.3 — partial unique index for ledger-layer idempotency.
            // Two purchase webhooks for the same Stripe event id, or two
            // reversal-on-read attempts for the same failed job, collide on
            // this index instead of double-crediting. EF Core can't fluently
            // express `WHERE idempotency_key IS NOT NULL`, so raw SQL.
            // FR29 structural invariant: credits never expire — no
            // expires_at column anywhere on credit_ledger.
            migrationBuilder.Sql(@"
                CREATE UNIQUE INDEX uq_credit_ledger_idempotency_key
                ON credit_ledger (idempotency_key)
                WHERE idempotency_key IS NOT NULL;
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP INDEX IF EXISTS uq_credit_ledger_idempotency_key;");

            migrationBuilder.DropTable(
                name: "credit_ledger");

            migrationBuilder.DropTable(
                name: "usage_events");

            migrationBuilder.DropColumn(
                name: "error_code",
                table: "analysis_jobs");
        }
    }
}
