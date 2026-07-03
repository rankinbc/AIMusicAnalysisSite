using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    /// <remarks>
    /// Story 4.4 review CRITICAL fix: AddNotifyAnalysisComplete backfilled
    /// the column with defaultValue FALSE — every pre-existing user was
    /// silently opted OUT of completion emails, contradicting the story's
    /// default-ON decision (the EF CLR initializer and python mirror both say
    /// true). Backfill is safe: the feature shipped minutes ago in the same
    /// PR — nobody has intentionally opted out yet.
    /// </remarks>
    public partial class FixNotifyAnalysisCompleteDefaultTrue : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "ALTER TABLE users ALTER COLUMN notify_analysis_complete SET DEFAULT true;");
            migrationBuilder.Sql(
                "UPDATE users SET notify_analysis_complete = true;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "ALTER TABLE users ALTER COLUMN notify_analysis_complete SET DEFAULT false;");
        }
    }
}
