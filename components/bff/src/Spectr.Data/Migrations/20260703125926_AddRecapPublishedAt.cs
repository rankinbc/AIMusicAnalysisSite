using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddRecapPublishedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "recap_published_at",
                table: "listening_sessions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_listening_sessions_host_recap_published",
                table: "listening_sessions",
                columns: new[] { "host_id", "recap_published_at" },
                filter: "recap_published_at IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_listening_sessions_host_recap_published",
                table: "listening_sessions");

            migrationBuilder.DropColumn(
                name: "recap_published_at",
                table: "listening_sessions");
        }
    }
}
