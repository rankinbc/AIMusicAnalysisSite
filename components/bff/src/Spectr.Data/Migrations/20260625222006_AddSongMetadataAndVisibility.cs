using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSongMetadataAndVisibility : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "description",
                table: "songs",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "reference_profile_id",
                table: "songs",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "reference_profile_kind",
                table: "songs",
                type: "character varying(8)",
                maxLength: 8,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "visibility",
                table: "songs",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "private");

            migrationBuilder.AddColumn<string>(
                name: "visual_primary",
                table: "songs",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "visual_secondary",
                table: "songs",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "visual_template",
                table: "songs",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "description",
                table: "songs");

            migrationBuilder.DropColumn(
                name: "reference_profile_id",
                table: "songs");

            migrationBuilder.DropColumn(
                name: "reference_profile_kind",
                table: "songs");

            migrationBuilder.DropColumn(
                name: "visibility",
                table: "songs");

            migrationBuilder.DropColumn(
                name: "visual_primary",
                table: "songs");

            migrationBuilder.DropColumn(
                name: "visual_secondary",
                table: "songs");

            migrationBuilder.DropColumn(
                name: "visual_template",
                table: "songs");
        }
    }
}
