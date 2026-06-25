using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddRackPresets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "rack_drafts",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    song_version_id = table.Column<Guid>(type: "uuid", nullable: false),
                    chain_json = table.Column<string>(type: "jsonb", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_rack_drafts", x => x.id);
                    table.ForeignKey(
                        name: "FK_rack_drafts_song_versions_song_version_id",
                        column: x => x.song_version_id,
                        principalTable: "song_versions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "rack_presets",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    song_version_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    source = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false, defaultValue: "user"),
                    chain_json = table.Column<string>(type: "jsonb", nullable: false),
                    created_in_session_id = table.Column<Guid>(type: "uuid", nullable: true),
                    via_grant_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_rack_presets", x => x.id);
                    table.CheckConstraint("ck_rack_presets_source", "\"source\" IN ('user','coach','analysis')");
                    table.ForeignKey(
                        name: "FK_rack_presets_song_versions_song_version_id",
                        column: x => x.song_version_id,
                        principalTable: "song_versions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "viz_presets",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    viz_json = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_viz_presets", x => x.id);
                    table.ForeignKey(
                        name: "FK_viz_presets_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "uq_rack_drafts_song_version_id",
                table: "rack_drafts",
                column: "song_version_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_rack_presets_song_version_id",
                table: "rack_presets",
                column: "song_version_id");

            migrationBuilder.CreateIndex(
                name: "ix_viz_presets_user_id",
                table: "viz_presets",
                column: "user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "rack_drafts");

            migrationBuilder.DropTable(
                name: "rack_presets");

            migrationBuilder.DropTable(
                name: "viz_presets");
        }
    }
}
