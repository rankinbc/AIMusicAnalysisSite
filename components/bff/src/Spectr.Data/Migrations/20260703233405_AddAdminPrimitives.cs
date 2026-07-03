using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddAdminPrimitives : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ban_reason",
                table: "users",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "banned_at",
                table: "users",
                type: "timestamp with time zone",
                nullable: true);

            // Story 10.5 — append-only becomes DB-ENFORCED. A trigger, not
            // REVOKE: the app role OWNS these tables and owners bypass
            // grants. audit_log is the privileged-action evidence;
            // credit_ledger is the money evidence.
            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION spectr_forbid_mutation() RETURNS trigger AS $$
                BEGIN
                    -- Deliberate session-scoped escape hatch (test cleanup +
                    -- any future court-ordered purge): SET spectr.allow_purge = '1'.
                    -- Requires a conscious, greppable act — accidental UPDATE/
                    -- DELETE from app code still dies.
                    IF current_setting('spectr.allow_purge', true) = '1' THEN
                        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
                        IF TG_OP = 'TRUNCATE' THEN RETURN NULL; END IF;
                        RETURN NEW;
                    END IF;
                    RAISE EXCEPTION '% is append-only (story 10.5)', TG_TABLE_NAME;
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER trg_audit_log_append_only
                    BEFORE UPDATE OR DELETE ON audit_log
                    FOR EACH ROW EXECUTE FUNCTION spectr_forbid_mutation();

                CREATE TRIGGER trg_credit_ledger_append_only
                    BEFORE UPDATE OR DELETE ON credit_ledger
                    FOR EACH ROW EXECUTE FUNCTION spectr_forbid_mutation();

                -- Row triggers do NOT fire on TRUNCATE (review High): without
                -- these, the whole evidence trail was one statement from gone.
                CREATE TRIGGER trg_audit_log_no_truncate
                    BEFORE TRUNCATE ON audit_log
                    FOR EACH STATEMENT EXECUTE FUNCTION spectr_forbid_mutation();

                CREATE TRIGGER trg_credit_ledger_no_truncate
                    BEFORE TRUNCATE ON credit_ledger
                    FOR EACH STATEMENT EXECUTE FUNCTION spectr_forbid_mutation();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER IF EXISTS trg_audit_log_append_only ON audit_log;
                DROP TRIGGER IF EXISTS trg_credit_ledger_append_only ON credit_ledger;
                DROP TRIGGER IF EXISTS trg_audit_log_no_truncate ON audit_log;
                DROP TRIGGER IF EXISTS trg_credit_ledger_no_truncate ON credit_ledger;
                DROP FUNCTION IF EXISTS spectr_forbid_mutation();
                """);

            migrationBuilder.DropColumn(
                name: "ban_reason",
                table: "users");

            migrationBuilder.DropColumn(
                name: "banned_at",
                table: "users");
        }
    }
}
