using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    /// <inheritdoc />
    public partial class Story57FreeRetry : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "retry_of_job_id",
                table: "analysis_jobs",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_analysis_jobs_retry_of_job_id",
                table: "analysis_jobs",
                column: "retry_of_job_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_analysis_jobs_retry_of_job_id",
                table: "analysis_jobs");

            migrationBuilder.DropColumn(
                name: "retry_of_job_id",
                table: "analysis_jobs");
        }
    }
}
