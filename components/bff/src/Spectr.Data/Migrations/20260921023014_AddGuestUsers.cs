using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddGuestUsers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "guest_device_id",
                table: "users",
                type: "character varying(26)",
                maxLength: 26,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "guest_expires_at",
                table: "users",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "is_guest",
                table: "users",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            // D1 — partial indexes for the resume-by-device lookup (D2) and
            // the nightly retention sweep's expiry scan. EF's fluent API
            // cannot express a WHERE clause on a CREATE INDEX.
            migrationBuilder.Sql("CREATE INDEX ix_users_guest_expires ON users (guest_expires_at) WHERE is_guest; CREATE INDEX ix_users_guest_device ON users (guest_device_id) WHERE is_guest;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP INDEX IF EXISTS ix_users_guest_expires; DROP INDEX IF EXISTS ix_users_guest_device;");

            migrationBuilder.DropColumn(
                name: "guest_device_id",
                table: "users");

            migrationBuilder.DropColumn(
                name: "guest_expires_at",
                table: "users");

            migrationBuilder.DropColumn(
                name: "is_guest",
                table: "users");
        }
    }
}
