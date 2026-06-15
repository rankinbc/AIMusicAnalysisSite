using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class DropRedundantConversationIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_conversations_analysis_id",
                table: "conversations");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_conversations_analysis_id",
                table: "conversations",
                column: "analysis_id");
        }
    }
}
