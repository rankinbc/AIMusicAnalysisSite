using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddDevicesAndDeviceOwnership : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<Guid>(
                name: "user_id",
                table: "conversations",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddColumn<string>(
                name: "device_id",
                table: "conversations",
                type: "character varying(26)",
                maxLength: 26,
                nullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "user_id",
                table: "analysis_jobs",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddColumn<string>(
                name: "device_id",
                table: "analysis_jobs",
                type: "character varying(26)",
                maxLength: 26,
                nullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "user_id",
                table: "analyses",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddColumn<string>(
                name: "device_id",
                table: "analyses",
                type: "character varying(26)",
                maxLength: 26,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "devices",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(26)", maxLength: 26, nullable: false),
                    ip_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ua_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    claimed_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    claimed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_devices", x => x.id);
                });

            // Story 4.5 (AR24) — exactly-one ownership. Raw SQL (ck_track_*
            // precedent): EF fluent CHECKs don't survive the snapshot cleanly
            // alongside the citext config here, and the predicate is shared
            // verbatim across the three tables.
            const string xor =
                "((user_id IS NOT NULL AND device_id IS NULL) OR (user_id IS NULL AND device_id IS NOT NULL))";
            migrationBuilder.Sql($"ALTER TABLE analysis_jobs ADD CONSTRAINT ck_analysis_jobs_owner_xor CHECK {xor};");
            migrationBuilder.Sql($"ALTER TABLE analyses ADD CONSTRAINT ck_analyses_owner_xor CHECK {xor};");
            migrationBuilder.Sql($"ALTER TABLE conversations ADD CONSTRAINT ck_conversations_owner_xor CHECK {xor};");

            // Claim + purge access paths.
            migrationBuilder.Sql("CREATE INDEX ix_analysis_jobs_device_id ON analysis_jobs (device_id) WHERE device_id IS NOT NULL;");
            migrationBuilder.Sql("CREATE INDEX ix_analyses_device_id ON analyses (device_id) WHERE device_id IS NOT NULL;");
            migrationBuilder.Sql("CREATE INDEX ix_conversations_device_id ON conversations (device_id) WHERE device_id IS NOT NULL;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE analysis_jobs DROP CONSTRAINT IF EXISTS ck_analysis_jobs_owner_xor;");
            migrationBuilder.Sql("ALTER TABLE analyses DROP CONSTRAINT IF EXISTS ck_analyses_owner_xor;");
            migrationBuilder.Sql("ALTER TABLE conversations DROP CONSTRAINT IF EXISTS ck_conversations_owner_xor;");

            migrationBuilder.DropTable(
                name: "devices");

            migrationBuilder.DropColumn(
                name: "device_id",
                table: "conversations");

            migrationBuilder.DropColumn(
                name: "device_id",
                table: "analysis_jobs");

            migrationBuilder.DropColumn(
                name: "device_id",
                table: "analyses");

            migrationBuilder.AlterColumn<Guid>(
                name: "user_id",
                table: "conversations",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "user_id",
                table: "analysis_jobs",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "user_id",
                table: "analyses",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);
        }
    }
}
