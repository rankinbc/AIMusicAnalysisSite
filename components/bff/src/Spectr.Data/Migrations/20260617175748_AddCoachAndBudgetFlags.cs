using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCoachAndBudgetFlags : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Story 2.6 / AR35 — seed the coach + budget cap flags so an operator
            // can tune them live (BFF + worker re-read within 60 s, no redeploy).
            //   coach_pro_monthly      : pooled monthly Pro coach cap (FR15).
            //   llm_budget_*_usd       : per-tier + global monthly SPEND ceilings,
            //                            seeded == the worker env defaults so this
            //                            seed changes NO behaviour — it only makes
            //                            the ceilings operator-tunable via the table.
            // Idempotent re-run via ON CONFLICT DO NOTHING (mirrors the 2.4 seed).
            migrationBuilder.Sql(@"
                INSERT INTO feature_flags (name, value) VALUES
                    ('coach_pro_monthly',    '300'),
                    ('llm_budget_free_usd',  '5.00'),
                    ('llm_budget_pro_usd',   '100.00'),
                    ('llm_budget_global_usd','1000.00')
                ON CONFLICT (name) DO NOTHING;
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                DELETE FROM feature_flags WHERE name IN (
                    'coach_pro_monthly',
                    'llm_budget_free_usd',
                    'llm_budget_pro_usd',
                    'llm_budget_global_usd'
                );
            ");
        }
    }
}
