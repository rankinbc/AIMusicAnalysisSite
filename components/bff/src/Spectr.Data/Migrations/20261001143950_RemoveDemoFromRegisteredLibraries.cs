using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Spectr.Data.Migrations
{
    // Owner decision (2026-10): the seeded demo song is for GUESTS only.
    // Story 12.8 seeded it into every registered account at sign-up; that
    // seeding is retired (AuthEndpoints.Register) and this one-time backfill
    // hard-deletes the demo song graph from every REGISTERED (non-guest)
    // library. Guest sandboxes are untouched.
    //
    // Why a migration (not an admin endpoint / startup task): it runs exactly
    // once per database on the normal deploy path (dev + prod alike), inside
    // the migration transaction, with no new attack surface and no operator
    // step to forget. It is idempotent anyway (a re-run matches nothing).
    //
    // DB-ONLY: storage is never touched — the demo blobs under "audio/demo/"
    // are shared by every guest. Identification and the full table graph are
    // documented on Spectr.Data.DemoLibraryCleanup; this is a FROZEN copy of
    // that statement as of this migration (a later schema change must not
    // retroactively change what a historical migration runs on a fresh DB).
    /// <inheritdoc />
    public partial class RemoveDemoFromRegisteredLibraries : Migration
    {
        // {0} = extra predicate on songs alias `s` (empty here; tests scope it
        // to their own users so they never touch other suites' rows).
        public const string SqlTemplate = """
            WITH ds AS (
                SELECT s.id FROM songs s
                JOIN users u ON u.id = s.user_id
                WHERE u.is_guest = false {0}
                  AND EXISTS (SELECT 1 FROM song_versions v
                              WHERE v.song_id = s.id
                                AND v.label = 'demo' AND v.file_path LIKE 'audio/demo/%')
                  AND NOT EXISTS (SELECT 1 FROM song_versions v
                              WHERE v.song_id = s.id
                                AND NOT (COALESCE(v.label, '') = 'demo'
                                         AND COALESCE(v.file_path, '') LIKE 'audio/demo/%'))
            ),
            dv AS (SELECT v.id FROM song_versions v WHERE v.song_id IN (SELECT id FROM ds)),
            da AS (SELECT a.id, a.job_id FROM analyses a
                   WHERE a.song_id IN (SELECT id FROM ds) OR a.version_id IN (SELECT id FROM dv)),
            dc AS (SELECT c.id FROM conversations c WHERE c.analysis_id IN (SELECT id FROM da)),
            dvd AS (SELECT vd.id FROM verdicts vd WHERE vd.analysis_id IN (SELECT id FROM da)),
            x_msgs AS (DELETE FROM coach_messages WHERE conversation_id IN (SELECT id FROM dc) RETURNING 1),
            x_convs AS (DELETE FROM conversations WHERE id IN (SELECT id FROM dc) RETURNING 1),
            x_vstate AS (DELETE FROM verdict_user_state WHERE verdict_id IN (SELECT id FROM dvd) RETURNING 1),
            x_verdicts AS (DELETE FROM verdicts WHERE id IN (SELECT id FROM dvd) RETURNING 1),
            x_analyses AS (DELETE FROM analyses WHERE id IN (SELECT id FROM da) RETURNING 1),
            x_jobs AS (DELETE FROM analysis_jobs
                       WHERE version_id IN (SELECT id FROM dv) OR id IN (SELECT job_id FROM da) RETURNING 1),
            x_notes AS (DELETE FROM session_notes WHERE version_id IN (SELECT id FROM dv) RETURNING 1),
            x_cmp AS (DELETE FROM compare_cache WHERE track_version_id IN (SELECT id FROM dv) RETURNING 1),
            x_ratings AS (DELETE FROM version_user_ratings WHERE version_id IN (SELECT id FROM dv) RETURNING 1),
            x_cnotes AS (DELETE FROM version_compare_notes
                         WHERE song_id IN (SELECT id FROM ds)
                            OR version_a_id IN (SELECT id FROM dv)
                            OR version_b_id IN (SELECT id FROM dv) RETURNING 1),
            x_versions AS (DELETE FROM song_versions WHERE id IN (SELECT id FROM dv) RETURNING 1)
            DELETE FROM songs WHERE id IN (SELECT id FROM ds)
        
            """;

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(string.Format(SqlTemplate, ""));
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Irreversible by design: deleted demo rows are not restored (a
            // registered user must not get the guest demo back on rollback).
        }
    }
}
