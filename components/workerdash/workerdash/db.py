"""Postgres reads/writes. Thin: every function takes an open connection so
tests can hand in a fake. Column names follow the EF snake_case schema."""
import os

import psycopg2


def connect():
    return psycopg2.connect(os.environ.get(
        "DATABASE_URL", "postgresql://spectr:spectr@localhost:5432/spectr"))


_CTX_SQL = """
SELECT j.id::text, coalesce(s.name,''), coalesce(v.label,''),
       j.status, j.current_phase
FROM analysis_jobs j
LEFT JOIN song_versions v ON v.id = j.version_id
LEFT JOIN songs s ON s.id = v.song_id
WHERE j.id::text = ANY(%s)
"""


def job_context(conn, job_ids):
    if not job_ids:
        return {}
    with conn.cursor() as cur:
        cur.execute(_CTX_SQL, (list(job_ids),))
        return {r[0]: {"song": r[1], "label": r[2],
                       "status": r[3], "current_phase": r[4]}
                for r in cur.fetchall()}


def processing_jobs(conn):
    with conn.cursor() as cur:
        cur.execute("""
            SELECT j.id::text, j.current_phase, j.phase_pct,
                   coalesce(s.name,''), coalesce(v.label,''), j.started_at::text
            FROM analysis_jobs j
            LEFT JOIN song_versions v ON v.id = j.version_id
            LEFT JOIN songs s ON s.id = v.song_id
            WHERE j.status = 'processing'
            ORDER BY j.started_at NULLS LAST
        """)
        return [{"id": r[0], "current_phase": r[1], "phase_pct": r[2],
                 "song": r[3], "label": r[4], "started_at": r[5]}
                for r in cur.fetchall()]


def recent_jobs(conn, limit=20):
    with conn.cursor() as cur:
        cur.execute("""
            SELECT j.id::text, j.status, coalesce(j.error_code,''),
                   coalesce(s.name,''), coalesce(v.label,''),
                   j.dispatched_at::text, coalesce(j.completed_at::text,'')
            FROM analysis_jobs j
            LEFT JOIN song_versions v ON v.id = j.version_id
            LEFT JOIN songs s ON s.id = v.song_id
            ORDER BY j.dispatched_at DESC
            LIMIT %s
        """, (limit,))
        return [{"id": r[0], "status": r[1], "error_code": r[2], "song": r[3],
                 "label": r[4], "dispatched_at": r[5], "completed_at": r[6]}
                for r in cur.fetchall()]


def mark_cancelled(conn, job_id):
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE analysis_jobs
            SET status = 'failed', error_code = 'cancelled_by_operator',
                failed_at = now()
            WHERE id::text = %s AND status IN ('pending','processing')
        """, (job_id,))
        updated = cur.rowcount > 0
    conn.commit()
    return updated


def mark_retry_pending(conn, job_id):
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE analysis_jobs
            SET status = 'pending', error_code = NULL, error_message = NULL,
                failed_at = NULL
            WHERE id::text = %s AND status = 'failed'
        """, (job_id,))
        updated = cur.rowcount > 0
    conn.commit()
    return updated


def revert_retry(conn, job_id):
    """Best-effort undo of mark_retry_pending when the enqueue step failed."""
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE analysis_jobs
            SET status = 'failed', error_code = 'retry_enqueue_failed',
                failed_at = now()
            WHERE id::text = %s AND status = 'pending'
        """, (job_id,))
        updated = cur.rowcount > 0
    conn.commit()
    return updated
