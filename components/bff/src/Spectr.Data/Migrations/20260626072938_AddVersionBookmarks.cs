using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddVersionBookmarks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_track_bookmarks_one_target",
                table: "track_bookmarks");

            migrationBuilder.AlterColumn<Guid>(
                name: "user_id",
                table: "track_bookmarks",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddColumn<string>(
                name: "bookmarker_anon_id",
                table: "track_bookmarks",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "bookmarker_display_name",
                table: "track_bookmarks",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "identity_visible",
                table: "track_bookmarks",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "note",
                table: "track_bookmarks",
                type: "character varying(280)",
                maxLength: 280,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "target_version_id",
                table: "track_bookmarks",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "timestamp_seconds",
                table: "track_bookmarks",
                type: "double precision",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_track_bookmarks_target_version_id",
                table: "track_bookmarks",
                column: "target_version_id");

            migrationBuilder.AddCheckConstraint(
                name: "ck_track_bookmarks_one_target",
                table: "track_bookmarks",
                sql: "(CASE WHEN target_share_token IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN target_published_track IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN target_version_id IS NOT NULL THEN 1 ELSE 0 END) = 1");

            migrationBuilder.AddForeignKey(
                name: "FK_track_bookmarks_song_versions_target_version_id",
                table: "track_bookmarks",
                column: "target_version_id",
                principalTable: "song_versions",
                principalColumn: "id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_track_bookmarks_song_versions_target_version_id",
                table: "track_bookmarks");

            migrationBuilder.DropIndex(
                name: "ix_track_bookmarks_target_version_id",
                table: "track_bookmarks");

            migrationBuilder.DropCheckConstraint(
                name: "ck_track_bookmarks_one_target",
                table: "track_bookmarks");

            migrationBuilder.DropColumn(
                name: "bookmarker_anon_id",
                table: "track_bookmarks");

            migrationBuilder.DropColumn(
                name: "bookmarker_display_name",
                table: "track_bookmarks");

            migrationBuilder.DropColumn(
                name: "identity_visible",
                table: "track_bookmarks");

            migrationBuilder.DropColumn(
                name: "note",
                table: "track_bookmarks");

            migrationBuilder.DropColumn(
                name: "target_version_id",
                table: "track_bookmarks");

            migrationBuilder.DropColumn(
                name: "timestamp_seconds",
                table: "track_bookmarks");

            migrationBuilder.AlterColumn<Guid>(
                name: "user_id",
                table: "track_bookmarks",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "ck_track_bookmarks_one_target",
                table: "track_bookmarks",
                sql: "(target_share_token IS NOT NULL AND target_published_track IS NULL) OR (target_share_token IS NULL AND target_published_track IS NOT NULL)");
        }
    }
}
