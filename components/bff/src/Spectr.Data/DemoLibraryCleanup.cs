using Microsoft.EntityFrameworkCore;

namespace Spectr.Data;

// Owner decision (2026-10): the seeded demo song is for GUESTS only. A
// registered (non-guest) account must never have it in its library. This is
// the ONE definition of "a registered user's demo song graph" and how to
// remove it, shared by:
//   - migration RemoveDemoFromRegisteredLibraries (one-time backfill: every
//     registered account that was seeded at registration under story 12.8),
//   - guest -> account conversion (GuestConversion callers), which keeps the
//     SAME users row and therefore would otherwise carry the guest demo over.
//
// Identification is by the seed's own fingerprint, never by name: a song
// qualifies only when EVERY one of its versions is a seeded demo version
// (label = 'demo' AND file_path under the shared "audio/demo/" prefix — a
// real upload is always stored under the user's own key, never there). A
// renamed demo still matches; a user's own song never does, and a demo song
// the user later added a real version to is left alone (deleting it would
// take their upload with it).
//
// DB-ONLY by design: this never touches storage. The demo audio/images are
// SHARED blobs under "audio/demo/" that every guest still plays.
//
// One statement (data-modifying CTEs share a single snapshot), so it is
// atomic without an explicit transaction and safe to re-run (idempotent —
// a second run matches nothing). Many of these tables carry no DB-level FK
// (repo convention — see SongEndpoints.HardDelete), so each is deleted
// explicitly; deleting song_versions/songs then DB-cascades rack_presets,
// rack_drafts and song_tags. Hard delete (not archive) so nothing shows up in
// Trash. llm_calls / usage_events / credit_ledger are cost & billing history
// with no FK into this graph — kept untouched.
public static class DemoLibraryCleanup
{
    // {0} = an extra predicate on songs alias `s` ("" for the global backfill).
    private const string Template = """
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

    /// <summary>Global backfill SQL — every registered (non-guest) account.</summary>
    public static readonly string AllRegisteredUsersSql = string.Format(Template, "");

    /// <summary>Same statement scoped to one user; parameter {0} = the user id.</summary>
    // (Format inserts the argument verbatim, so the literal "{0}" survives as
    // EF's raw-SQL parameter slot.)
    public static readonly string SingleUserSql = string.Format(Template, "AND s.user_id = {0}");

    /// <summary>Remove the demo song graph from ONE (now non-guest) user's library.
    /// Returns the number of songs deleted. DB-only; never touches storage.</summary>
    public static Task<int> RemoveForUserAsync(DbContext db, Guid userId, CancellationToken ct = default)
        => db.Database.ExecuteSqlRawAsync(SingleUserSql, [userId], ct);
}
