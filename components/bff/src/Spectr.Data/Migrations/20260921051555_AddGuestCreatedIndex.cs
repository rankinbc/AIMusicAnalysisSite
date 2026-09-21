using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddGuestCreatedIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Task D5 fix round 1 (I3) — POST /api/auth/demo's daily-cap CountAsync
            // filters on (is_guest, created_at) on every unauthenticated request;
            // without this the guest rows are a seq scan over the whole users
            // table. Partial index: only guest rows are ever queried this way.
            migrationBuilder.Sql(
                "CREATE INDEX ix_users_guest_created ON users (created_at) WHERE is_guest;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_users_guest_created;");
        }
    }
}
