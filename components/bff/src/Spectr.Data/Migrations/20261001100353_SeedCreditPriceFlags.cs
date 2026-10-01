using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class SeedCreditPriceFlags : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Credit economy (PRPs/archive/2026-10-01_credit-economy.md) — live price list. ON CONFLICT
            // keeps an operator's already-tuned value on re-run. (The sign-up grant
            // already lives in `signup_bonus_credits`, seeded by AddSignupBonusCredits.)
            migrationBuilder.Sql(@"
                INSERT INTO feature_flags (name, value, updated_at) VALUES
                  ('credit_cost_analysis', '100', now()),
                  ('credit_cost_specialist', '15', now()),
                  ('credit_cost_coach_message', '5', now()),
                  ('credit_cost_coach_mix', '5', now()),
                  ('pro_analyses_monthly', '15', now()),
                  ('llm_budget_credits_usd', '100', now())
                ON CONFLICT (name) DO NOTHING;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                DELETE FROM feature_flags WHERE name IN (
                  'credit_cost_analysis','credit_cost_specialist','credit_cost_coach_message',
                  'credit_cost_coach_mix','pro_analyses_monthly','llm_budget_credits_usd');");
        }
    }
}
