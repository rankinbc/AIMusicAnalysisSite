using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class RemoveSocial : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_rack_presets_control_grants_via_grant_id",
                table: "rack_presets");

            migrationBuilder.DropForeignKey(
                name: "FK_rack_presets_listening_sessions_created_in_session_id",
                table: "rack_presets");

            migrationBuilder.DropForeignKey(
                name: "FK_rack_presets_suggestions_from_suggestion_id",
                table: "rack_presets");

            migrationBuilder.DropForeignKey(
                name: "FK_suggestions_listening_sessions_created_in_session_id",
                table: "suggestions");

            migrationBuilder.DropForeignKey(
                name: "FK_suggestions_track_comments_comment_id",
                table: "suggestions");

            migrationBuilder.DropTable(
                name: "control_grants");

            migrationBuilder.DropTable(
                name: "follow_relations");

            migrationBuilder.DropTable(
                name: "invites");

            migrationBuilder.DropTable(
                name: "share_settings");

            migrationBuilder.DropTable(
                name: "track_bookmarks");

            migrationBuilder.DropTable(
                name: "listening_sessions");

            migrationBuilder.DropTable(
                name: "track_comments");

            migrationBuilder.DropTable(
                name: "suggestions");

            migrationBuilder.DropIndex(
                name: "IX_users_handle",
                table: "users");

            migrationBuilder.DropIndex(
                name: "IX_rack_presets_created_in_session_id",
                table: "rack_presets");

            migrationBuilder.DropIndex(
                name: "IX_rack_presets_from_suggestion_id",
                table: "rack_presets");

            migrationBuilder.DropIndex(
                name: "IX_rack_presets_via_grant_id",
                table: "rack_presets");

            migrationBuilder.DropIndex(
                name: "IX_analyses_share_token",
                table: "analyses");

            migrationBuilder.DropColumn(
                name: "accent",
                table: "users");

            migrationBuilder.DropColumn(
                name: "avatar_hue",
                table: "users");

            migrationBuilder.DropColumn(
                name: "banner_hue",
                table: "users");

            migrationBuilder.DropColumn(
                name: "bio",
                table: "users");

            migrationBuilder.DropColumn(
                name: "handle",
                table: "users");

            migrationBuilder.DropColumn(
                name: "public_link",
                table: "users");

            migrationBuilder.DropColumn(
                name: "visibility",
                table: "songs");

            migrationBuilder.DropColumn(
                name: "is_public",
                table: "song_tags");

            migrationBuilder.DropColumn(
                name: "created_in_session_id",
                table: "rack_presets");

            migrationBuilder.DropColumn(
                name: "from_suggestion_id",
                table: "rack_presets");

            migrationBuilder.DropColumn(
                name: "via_grant_id",
                table: "rack_presets");

            migrationBuilder.DropColumn(
                name: "share_enabled_at",
                table: "analyses");

            migrationBuilder.DropColumn(
                name: "share_show_verdicts",
                table: "analyses");

            migrationBuilder.DropColumn(
                name: "share_token",
                table: "analyses");

            migrationBuilder.Sql(
                "DELETE FROM feature_flags WHERE name IN ('room_hosting_enabled','room_host_min_tier');");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                INSERT INTO feature_flags (name, value) VALUES
                  ('room_hosting_enabled','false'), ('room_host_min_tier','pro')
                ON CONFLICT (name) DO NOTHING;
                """);

            migrationBuilder.AddColumn<string>(
                name: "accent",
                table: "users",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<short>(
                name: "avatar_hue",
                table: "users",
                type: "smallint",
                nullable: true);

            migrationBuilder.AddColumn<short>(
                name: "banner_hue",
                table: "users",
                type: "smallint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "bio",
                table: "users",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "handle",
                table: "users",
                type: "citext",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "public_link",
                table: "users",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "visibility",
                table: "songs",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "private");

            migrationBuilder.AddColumn<bool>(
                name: "is_public",
                table: "song_tags",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<Guid>(
                name: "created_in_session_id",
                table: "rack_presets",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "from_suggestion_id",
                table: "rack_presets",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "via_grant_id",
                table: "rack_presets",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "share_enabled_at",
                table: "analyses",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "share_show_verdicts",
                table: "analyses",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "share_token",
                table: "analyses",
                type: "character varying(36)",
                maxLength: 36,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "follow_relations",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    followee_id = table.Column<Guid>(type: "uuid", nullable: false),
                    follower_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_follow_relations", x => x.id);
                    table.CheckConstraint("ck_follow_relations_no_self", "follower_id <> followee_id");
                    table.ForeignKey(
                        name: "FK_follow_relations_users_followee_id",
                        column: x => x.followee_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_follow_relations_users_follower_id",
                        column: x => x.follower_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "invites",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    accepted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    created_by = table.Column<Guid>(type: "uuid", nullable: false),
                    invited_email = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    invited_handle = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    invited_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    role = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    scope = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    session_id = table.Column<Guid>(type: "uuid", nullable: true),
                    song_version_id = table.Column<Guid>(type: "uuid", nullable: true),
                    status = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    token = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: false)
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
                name: "listening_sessions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    ended_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    events_json = table.Column<string>(type: "jsonb", nullable: true),
                    host_id = table.Column<Guid>(type: "uuid", nullable: false),
                    recap_json = table.Column<string>(type: "jsonb", nullable: true),
                    recap_published_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    song_version_id = table.Column<Guid>(type: "uuid", nullable: false),
                    started_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    status = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false)
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
                name: "share_settings",
                columns: table => new
                {
                    song_version_id = table.Column<Guid>(type: "uuid", nullable: false),
                    bookmarking_allowed = table.Column<bool>(type: "boolean", nullable: false),
                    comments_policy = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    enabled_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    session_host_policy = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    session_join_policy = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    share_token = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: true),
                    show_verdicts = table.Column<bool>(type: "boolean", nullable: false),
                    suggestions_allowed = table.Column<bool>(type: "boolean", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    visibility = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false)
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

            migrationBuilder.CreateTable(
                name: "track_bookmarks",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    bookmarker_anon_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    bookmarker_display_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    identity_visible = table.Column<bool>(type: "boolean", nullable: false),
                    note = table.Column<string>(type: "character varying(280)", maxLength: 280, nullable: true),
                    target_published_track = table.Column<Guid>(type: "uuid", nullable: true),
                    target_share_token = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: true),
                    target_version_id = table.Column<Guid>(type: "uuid", nullable: true),
                    timestamp_seconds = table.Column<double>(type: "double precision", nullable: true),
                    user_id = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_track_bookmarks", x => x.id);
                    table.CheckConstraint("ck_track_bookmarks_one_target", "(CASE WHEN target_share_token IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN target_published_track IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN target_version_id IS NOT NULL THEN 1 ELSE 0 END) = 1");
                    table.ForeignKey(
                        name: "FK_track_bookmarks_song_versions_target_version_id",
                        column: x => x.target_version_id,
                        principalTable: "song_versions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "control_grants",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    granted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    granted_by = table.Column<Guid>(type: "uuid", nullable: false),
                    grantee_anon_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    grantee_display_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    grantee_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    revoked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    scope = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    session_id = table.Column<Guid>(type: "uuid", nullable: false)
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

            migrationBuilder.CreateTable(
                name: "suggestions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    chain_json = table.Column<string>(type: "jsonb", nullable: false),
                    comment_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    created_in_session_id = table.Column<Guid>(type: "uuid", nullable: true),
                    from_anon_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    from_display_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    from_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    resolved_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    song_version_id = table.Column<Guid>(type: "uuid", nullable: false),
                    status = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    via_grant_id = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_suggestions", x => x.id);
                    table.CheckConstraint("ck_suggestions_status", "\"status\" IN ('proposed','auditioned','accepted','rejected')");
                    table.ForeignKey(
                        name: "FK_suggestions_listening_sessions_created_in_session_id",
                        column: x => x.created_in_session_id,
                        principalTable: "listening_sessions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_suggestions_song_versions_song_version_id",
                        column: x => x.song_version_id,
                        principalTable: "song_versions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_suggestions_users_from_user_id",
                        column: x => x.from_user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "track_comments",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    author_anon_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    author_display_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    author_ip_hash = table.Column<byte[]>(type: "bytea", nullable: true),
                    author_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    body = table.Column<string>(type: "text", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    parent_id = table.Column<Guid>(type: "uuid", nullable: true),
                    status = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    suggestion_id = table.Column<Guid>(type: "uuid", nullable: true),
                    target_published_track = table.Column<Guid>(type: "uuid", nullable: true),
                    target_share_token = table.Column<string>(type: "character varying(36)", maxLength: 36, nullable: true),
                    target_version_id = table.Column<Guid>(type: "uuid", nullable: true),
                    timestamp_seconds = table.Column<double>(type: "double precision", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_track_comments", x => x.id);
                    table.CheckConstraint("ck_track_comments_one_target", "(CASE WHEN target_share_token IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN target_published_track IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN target_version_id IS NOT NULL THEN 1 ELSE 0 END) = 1");
                    table.CheckConstraint("ck_track_comments_status", "\"status\" IN ('open','resolved','pinned','hidden')");
                    table.ForeignKey(
                        name: "FK_track_comments_song_versions_target_version_id",
                        column: x => x.target_version_id,
                        principalTable: "song_versions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_track_comments_suggestions_suggestion_id",
                        column: x => x.suggestion_id,
                        principalTable: "suggestions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_track_comments_track_comments_parent_id",
                        column: x => x.parent_id,
                        principalTable: "track_comments",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_users_handle",
                table: "users",
                column: "handle",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_rack_presets_created_in_session_id",
                table: "rack_presets",
                column: "created_in_session_id");

            migrationBuilder.CreateIndex(
                name: "IX_rack_presets_from_suggestion_id",
                table: "rack_presets",
                column: "from_suggestion_id");

            migrationBuilder.CreateIndex(
                name: "IX_rack_presets_via_grant_id",
                table: "rack_presets",
                column: "via_grant_id");

            migrationBuilder.CreateIndex(
                name: "IX_analyses_share_token",
                table: "analyses",
                column: "share_token",
                unique: true);

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
                name: "ix_follow_relations_followee",
                table: "follow_relations",
                column: "followee_id");

            migrationBuilder.CreateIndex(
                name: "ux_follow_relations_pair",
                table: "follow_relations",
                columns: new[] { "follower_id", "followee_id" },
                unique: true);

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
                name: "ix_listening_sessions_host_id",
                table: "listening_sessions",
                column: "host_id");

            migrationBuilder.CreateIndex(
                name: "ix_listening_sessions_host_recap_published",
                table: "listening_sessions",
                columns: new[] { "host_id", "recap_published_at" },
                filter: "recap_published_at IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_listening_sessions_song_version_id",
                table: "listening_sessions",
                column: "song_version_id");

            migrationBuilder.CreateIndex(
                name: "ix_listening_sessions_status",
                table: "listening_sessions",
                column: "status");

            migrationBuilder.CreateIndex(
                name: "uq_share_settings_share_token",
                table: "share_settings",
                column: "share_token",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_suggestions_comment_id",
                table: "suggestions",
                column: "comment_id");

            migrationBuilder.CreateIndex(
                name: "IX_suggestions_created_in_session_id",
                table: "suggestions",
                column: "created_in_session_id");

            migrationBuilder.CreateIndex(
                name: "ix_suggestions_from_user_id",
                table: "suggestions",
                column: "from_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_suggestions_song_version_id",
                table: "suggestions",
                column: "song_version_id");

            migrationBuilder.CreateIndex(
                name: "ix_track_bookmarks_target_version_id",
                table: "track_bookmarks",
                column: "target_version_id");

            migrationBuilder.CreateIndex(
                name: "IX_track_bookmarks_user_id",
                table: "track_bookmarks",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_track_comments_parent_id",
                table: "track_comments",
                column: "parent_id");

            migrationBuilder.CreateIndex(
                name: "IX_track_comments_suggestion_id",
                table: "track_comments",
                column: "suggestion_id");

            migrationBuilder.CreateIndex(
                name: "IX_track_comments_target_share_token",
                table: "track_comments",
                column: "target_share_token");

            migrationBuilder.CreateIndex(
                name: "ix_track_comments_target_version_id",
                table: "track_comments",
                column: "target_version_id");

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
                name: "FK_rack_presets_suggestions_from_suggestion_id",
                table: "rack_presets",
                column: "from_suggestion_id",
                principalTable: "suggestions",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_suggestions_track_comments_comment_id",
                table: "suggestions",
                column: "comment_id",
                principalTable: "track_comments",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }
    }
}
