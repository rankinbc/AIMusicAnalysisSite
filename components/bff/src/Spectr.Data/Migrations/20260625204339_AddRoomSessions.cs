using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddRoomSessions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "listening_sessions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    song_version_id = table.Column<Guid>(type: "uuid", nullable: false),
                    host_id = table.Column<Guid>(type: "uuid", nullable: false),
                    status = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    started_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    ended_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    events_json = table.Column<string>(type: "jsonb", nullable: true),
                    recap_json = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_listening_sessions", x => x.id);
                    table.CheckConstraint("ck_listening_sessions_status", "\"status\" IN ('live','ended')");
                    table.ForeignKey(
                        name: "FK_listening_sessions_song_versions_song_version_id",
                        column: x => x.song_version_id,
                        principalTable: "song_versions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_listening_sessions_users_host_id",
                        column: x => x.host_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "control_grants",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    session_id = table.Column<Guid>(type: "uuid", nullable: false),
                    scope = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    grantee_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    grantee_display_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    grantee_anon_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    granted_by = table.Column<Guid>(type: "uuid", nullable: false),
                    granted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    revoked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_control_grants", x => x.id);
                    table.CheckConstraint("ck_control_grants_scope", "\"scope\" IN ('rack','visuals')");
                    table.ForeignKey(
                        name: "FK_control_grants_listening_sessions_session_id",
                        column: x => x.session_id,
                        principalTable: "listening_sessions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_control_grants_users_granted_by",
                        column: x => x.granted_by,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_control_grants_users_grantee_user_id",
                        column: x => x.grantee_user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_suggestions_created_in_session_id",
                table: "suggestions",
                column: "created_in_session_id");

            migrationBuilder.CreateIndex(
                name: "IX_rack_presets_created_in_session_id",
                table: "rack_presets",
                column: "created_in_session_id");

            migrationBuilder.CreateIndex(
                name: "IX_rack_presets_via_grant_id",
                table: "rack_presets",
                column: "via_grant_id");

            migrationBuilder.CreateIndex(
                name: "IX_control_grants_granted_by",
                table: "control_grants",
                column: "granted_by");

            migrationBuilder.CreateIndex(
                name: "IX_control_grants_grantee_user_id",
                table: "control_grants",
                column: "grantee_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_control_grants_session_id",
                table: "control_grants",
                column: "session_id");

            migrationBuilder.CreateIndex(
                name: "ix_listening_sessions_host_id",
                table: "listening_sessions",
                column: "host_id");

            migrationBuilder.CreateIndex(
                name: "ix_listening_sessions_song_version_id",
                table: "listening_sessions",
                column: "song_version_id");

            migrationBuilder.CreateIndex(
                name: "ix_listening_sessions_status",
                table: "listening_sessions",
                column: "status");

            migrationBuilder.AddForeignKey(
                name: "FK_rack_presets_control_grants_via_grant_id",
                table: "rack_presets",
                column: "via_grant_id",
                principalTable: "control_grants",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_rack_presets_listening_sessions_created_in_session_id",
                table: "rack_presets",
                column: "created_in_session_id",
                principalTable: "listening_sessions",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_suggestions_listening_sessions_created_in_session_id",
                table: "suggestions",
                column: "created_in_session_id",
                principalTable: "listening_sessions",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            // ONE active holder per (session, scope) — seams §2 / decision D3.
            // EF can't express a partial (WHERE) unique index fluently, so it's
            // raw SQL. Granting a held scope auto-revokes the prior active grant
            // in the same tx, so this only ever rejects a true double-insert race.
            migrationBuilder.Sql(
                "CREATE UNIQUE INDEX uq_control_grants_active_scope "
                + "ON control_grants (session_id, scope) WHERE revoked_at IS NULL;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP INDEX IF EXISTS uq_control_grants_active_scope;");

            migrationBuilder.DropForeignKey(
                name: "FK_rack_presets_control_grants_via_grant_id",
                table: "rack_presets");

            migrationBuilder.DropForeignKey(
                name: "FK_rack_presets_listening_sessions_created_in_session_id",
                table: "rack_presets");

            migrationBuilder.DropForeignKey(
                name: "FK_suggestions_listening_sessions_created_in_session_id",
                table: "suggestions");

            migrationBuilder.DropTable(
                name: "control_grants");

            migrationBuilder.DropTable(
                name: "listening_sessions");

            migrationBuilder.DropIndex(
                name: "IX_suggestions_created_in_session_id",
                table: "suggestions");

            migrationBuilder.DropIndex(
                name: "IX_rack_presets_created_in_session_id",
                table: "rack_presets");

            migrationBuilder.DropIndex(
                name: "IX_rack_presets_via_grant_id",
                table: "rack_presets");
        }
    }
}
