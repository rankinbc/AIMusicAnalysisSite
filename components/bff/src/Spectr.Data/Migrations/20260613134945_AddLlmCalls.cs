using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddLlmCalls : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "llm_calls",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    tier = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    purpose = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    prompt_slug = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    prompt_version = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    model = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    input_tokens = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    output_tokens = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    cost_usd = table.Column<decimal>(type: "numeric(12,6)", nullable: false, defaultValue: 0m),
                    price_table_version = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    latency_ms = table.Column<int>(type: "integer", nullable: false),
                    outcome = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    correlation_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_llm_calls", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_llm_calls_created_at",
                table: "llm_calls",
                column: "created_at");

            migrationBuilder.CreateIndex(
                name: "IX_llm_calls_user_id_created_at",
                table: "llm_calls",
                columns: new[] { "user_id", "created_at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "llm_calls");
        }
    }
}
