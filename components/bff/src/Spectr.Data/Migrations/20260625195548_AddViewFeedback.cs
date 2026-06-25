using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddViewFeedback : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_track_comments_one_target",
                table: "track_comments");

            migrationBuilder.AddColumn<string>(
                name: "author_anon_id",
                table: "track_comments",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "parent_id",
                table: "track_comments",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "status",
                table: "track_comments",
                type: "character varying(10)",
                maxLength: 10,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<Guid>(
                name: "suggestion_id",
                table: "track_comments",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "target_version_id",
                table: "track_comments",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "from_suggestion_id",
                table: "rack_presets",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "suggestions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    song_version_id = table.Column<Guid>(type: "uuid", nullable: false),
                    from_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    from_display_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    from_anon_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    chain_json = table.Column<string>(type: "jsonb", nullable: false),
                    comment_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_in_session_id = table.Column<Guid>(type: "uuid", nullable: true),
                    via_grant_id = table.Column<Guid>(type: "uuid", nullable: true),
                    status = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    resolved_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_suggestions", x => x.id);
                    table.CheckConstraint("ck_suggestions_status", "\"status\" IN ('proposed','auditioned','accepted','rejected')");
                    table.ForeignKey(
                        name: "FK_suggestions_song_versions_song_version_id",
                        column: x => x.song_version_id,
                        principalTable: "song_versions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_suggestions_track_comments_comment_id",
                        column: x => x.comment_id,
                        principalTable: "track_comments",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_suggestions_users_from_user_id",
                        column: x => x.from_user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "ix_track_comments_parent_id",
                table: "track_comments",
                column: "parent_id");

            migrationBuilder.CreateIndex(
                name: "IX_track_comments_suggestion_id",
                table: "track_comments",
                column: "suggestion_id");

            migrationBuilder.CreateIndex(
                name: "ix_track_comments_target_version_id",
                table: "track_comments",
                column: "target_version_id");

            migrationBuilder.AddCheckConstraint(
                name: "ck_track_comments_one_target",
                table: "track_comments",
                sql: "(CASE WHEN target_share_token IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN target_published_track IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN target_version_id IS NOT NULL THEN 1 ELSE 0 END) = 1");

            migrationBuilder.AddCheckConstraint(
                name: "ck_track_comments_status",
                table: "track_comments",
                sql: "\"status\" IN ('open','resolved','pinned','hidden')");

            migrationBuilder.CreateIndex(
                name: "IX_rack_presets_from_suggestion_id",
                table: "rack_presets",
                column: "from_suggestion_id");

            migrationBuilder.CreateIndex(
                name: "IX_suggestions_comment_id",
                table: "suggestions",
                column: "comment_id");

            migrationBuilder.CreateIndex(
                name: "ix_suggestions_from_user_id",
                table: "suggestions",
                column: "from_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_suggestions_song_version_id",
                table: "suggestions",
                column: "song_version_id");

            migrationBuilder.AddForeignKey(
                name: "FK_rack_presets_suggestions_from_suggestion_id",
                table: "rack_presets",
                column: "from_suggestion_id",
                principalTable: "suggestions",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_track_comments_song_versions_target_version_id",
                table: "track_comments",
                column: "target_version_id",
                principalTable: "song_versions",
                principalColumn: "id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_track_comments_suggestions_suggestion_id",
                table: "track_comments",
                column: "suggestion_id",
                principalTable: "suggestions",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_track_comments_track_comments_parent_id",
                table: "track_comments",
                column: "parent_id",
                principalTable: "track_comments",
                principalColumn: "id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_rack_presets_suggestions_from_suggestion_id",
                table: "rack_presets");

            migrationBuilder.DropForeignKey(
                name: "FK_track_comments_song_versions_target_version_id",
                table: "track_comments");

            migrationBuilder.DropForeignKey(
                name: "FK_track_comments_suggestions_suggestion_id",
                table: "track_comments");

            migrationBuilder.DropForeignKey(
                name: "FK_track_comments_track_comments_parent_id",
                table: "track_comments");

            migrationBuilder.DropTable(
                name: "suggestions");

            migrationBuilder.DropIndex(
                name: "ix_track_comments_parent_id",
                table: "track_comments");

            migrationBuilder.DropIndex(
                name: "IX_track_comments_suggestion_id",
                table: "track_comments");

            migrationBuilder.DropIndex(
                name: "ix_track_comments_target_version_id",
                table: "track_comments");

            migrationBuilder.DropCheckConstraint(
                name: "ck_track_comments_one_target",
                table: "track_comments");

            migrationBuilder.DropCheckConstraint(
                name: "ck_track_comments_status",
                table: "track_comments");

            migrationBuilder.DropIndex(
                name: "IX_rack_presets_from_suggestion_id",
                table: "rack_presets");

            migrationBuilder.DropColumn(
                name: "author_anon_id",
                table: "track_comments");

            migrationBuilder.DropColumn(
                name: "parent_id",
                table: "track_comments");

            migrationBuilder.DropColumn(
                name: "status",
                table: "track_comments");

            migrationBuilder.DropColumn(
                name: "suggestion_id",
                table: "track_comments");

            migrationBuilder.DropColumn(
                name: "target_version_id",
                table: "track_comments");

            migrationBuilder.DropColumn(
                name: "from_suggestion_id",
                table: "rack_presets");

            migrationBuilder.AddCheckConstraint(
                name: "ck_track_comments_one_target",
                table: "track_comments",
                sql: "(target_share_token IS NOT NULL AND target_published_track IS NULL) OR (target_share_token IS NULL AND target_published_track IS NOT NULL)");
        }
    }
}
