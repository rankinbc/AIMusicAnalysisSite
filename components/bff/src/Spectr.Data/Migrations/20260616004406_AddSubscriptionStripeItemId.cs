using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSubscriptionStripeItemId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Story 2.2 / Task 6.2 — nullable on purpose. Existing
            // subscription rows from story 2.1 don't have this column
            // populated; they will backfill on the next
            // customer.subscription.updated webhook (typically within
            // hours of the next billing event). The BFF's
            // /api/billing/change-cadence endpoint returns
            // `subscription_not_ready` (409) for any row where this
            // column is still null. No data migration required.
            migrationBuilder.AddColumn<string>(
                name: "stripe_item_id",
                table: "subscriptions",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "stripe_item_id",
                table: "subscriptions");
        }
    }
}
