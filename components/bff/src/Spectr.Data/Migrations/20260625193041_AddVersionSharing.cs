using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddVersionSharing : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "invites",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    scope = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    song_version_id = table.Column<Guid>(type: "uuid", nullable: true),
                    session_id = table.Column<Guid>(type: "uuid", nullable: true),
                    invited_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    invited_email = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    invited_handle = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    role = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    token = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false),
                    status = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    created_by = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    accepted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_invites", x => x.id);
                    table.CheckConstraint("ck_invites_role", "\"role\" IN ('reviewer','listener','host')");
                    table.CheckConstraint("ck_invites_scope", "\"scope\" IN ('version','session')");
                    table.CheckConstraint("ck_invites_status", "\"status\" IN ('pending','accepted','revoked')");
                    table.ForeignKey(
                        name: "FK_invites_song_versions_song_version_id",
                        column: x => x.song_version_id,
                        principalTable: "song_versions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_invites_users_created_by",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_invites_users_invited_user_id",
                        column: x => x.invited_user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "share_settings",
                columns: table => new
                {
                    song_version_id = table.Column<Guid>(type: "uuid", nullable: false),
                    visibility = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    share_token = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: true),
                    show_verdicts = table.Column<bool>(type: "boolean", nullable: false),
                    comments_policy = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    suggestions_allowed = table.Column<bool>(type: "boolean", nullable: false),
                    bookmarking_allowed = table.Column<bool>(type: "boolean", nullable: false),
                    session_host_policy = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    session_join_policy = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    enabled_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_share_settings", x => x.song_version_id);
                    table.CheckConstraint("ck_share_settings_comments_policy", "\"comments_policy\" IN ('off','link','named')");
                    table.CheckConstraint("ck_share_settings_host_policy", "\"session_host_policy\" IN ('owner_only','invited')");
                    table.CheckConstraint("ck_share_settings_join_policy", "\"session_join_policy\" IN ('invited','link','public')");
                    table.CheckConstraint("ck_share_settings_visibility", "\"visibility\" IN ('private','unlisted','public')");
                    table.ForeignKey(
                        name: "FK_share_settings_song_versions_song_version_id",
                        column: x => x.song_version_id,
                        principalTable: "song_versions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_invites_created_by",
                table: "invites",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "ix_invites_invited_user_id",
                table: "invites",
                column: "invited_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_invites_song_version_id",
                table: "invites",
                column: "song_version_id");

            migrationBuilder.CreateIndex(
                name: "uq_invites_token",
                table: "invites",
                column: "token",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "uq_share_settings_share_token",
                table: "share_settings",
                column: "share_token",
                unique: true);

            // Idempotent feature-flag seed (story 2.6 pattern). Room hosting ships
            // OFF for the general user base (Work/View only); the admin hosts the
            // sole Room(s) by flipping room_hosting_enabled operationally — which is
            // what lets PRP-4 G5 (hosting metering) defer. Values are plain strings
            // (not JSON-quoted) so AccessService compares the tier directly.
            migrationBuilder.Sql(
                "INSERT INTO feature_flags (name, value) VALUES " +
                "('room_hosting_enabled', 'false'), ('room_host_min_tier', 'pro') " +
                "ON CONFLICT (name) DO NOTHING;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "invites");

            migrationBuilder.DropTable(
                name: "share_settings");

            migrationBuilder.Sql(
                "DELETE FROM feature_flags WHERE name IN ('room_hosting_enabled', 'room_host_min_tier');");
        }
    }
}
