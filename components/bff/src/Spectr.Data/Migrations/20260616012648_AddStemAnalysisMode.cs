using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddStemAnalysisMode : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "stem_analysis_mode",
                table: "song_versions",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "grouped");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "stem_analysis_mode",
                table: "song_versions");
        }
    }
}
