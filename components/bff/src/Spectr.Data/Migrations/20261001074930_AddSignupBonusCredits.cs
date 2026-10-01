using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSignupBonusCredits : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_credit_ledger_reason",
                table: "credit_ledger");

            migrationBuilder.AddCheckConstraint(
                name: "ck_credit_ledger_reason",
                table: "credit_ledger",
                sql: "\"reason\" IN ('purchase','spend','reversal','adjustment','signup_bonus')");

            // Owner decision 2026-10 — one-time credits granted when a new
            // permanent account is activated (email verified). 0 disables.
            // Idempotent seed of a NEW name; never overwrites live tuning.
            migrationBuilder.Sql("""
                INSERT INTO feature_flags (name, value, updated_at) VALUES
                    ('signup_bonus_credits', '500', now())
                ON CONFLICT (name) DO NOTHING;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DELETE FROM feature_flags WHERE name IN ('signup_bonus_credits');
                """);

            // NOTE: re-narrowing the CHECK fails while any 'signup_bonus'
            // ledger rows exist — the ledger is append-only (trigger), so a
            // rollback past this point needs an operator decision first.
            migrationBuilder.DropCheckConstraint(
                name: "ck_credit_ledger_reason",
                table: "credit_ledger");

            migrationBuilder.AddCheckConstraint(
                name: "ck_credit_ledger_reason",
                table: "credit_ledger",
                sql: "\"reason\" IN ('purchase','spend','reversal','adjustment')");
        }
    }
}
