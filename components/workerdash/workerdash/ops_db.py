"""Operations-tab Postgres reads: run history, drill-down detail, and the
token/cost rollup. Kept separate from db.py, which stays scoped to the
live queue/job-mutation queries workerdash already had."""


def _build_filters(search, status, since, until):
    where = []
    params = []
    if search:
        where.append("(s.name ILIKE %s OR v.label ILIKE %s)")
        like = f"%{search}%"
        params.extend([like, like])
    if status:
        where.append("j.status = %s")
        params.append(status)
    if since:
        where.append("j.dispatched_at >= %s")
        params.append(since)
    if until:
        where.append("j.dispatched_at <= %s")
        params.append(until)
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    return clause, params


_FROM = """
FROM analysis_jobs j
LEFT JOIN song_versions v ON v.id = j.version_id
LEFT JOIN songs s ON s.id = v.song_id
LEFT JOIN analyses a ON a.job_id = j.id
"""


def list_jobs(conn, search=None, status=None, since=None, until=None,
              page=1, page_size=25):
    clause, params = _build_filters(search, status, since, until)
    with conn.cursor() as cur:
        cur.execute(f"SELECT count(*) {_FROM}{clause}", params)
        total = cur.fetchone()[0]

        offset = (page - 1) * page_size
        cur.execute(
            f"""
            SELECT j.id::text, j.status, coalesce(j.error_code,''),
                   coalesce(s.name,''), coalesce(v.label,''), v.version_number,
                   coalesce(j.file_path,''), a.id::text, coalesce(j.tier,''),
                   j.dispatched_at::text, coalesce(j.completed_at::text,'')
            {_FROM}{clause}
            ORDER BY j.dispatched_at DESC
            LIMIT %s OFFSET %s
            """,
            tuple(params) + (page_size, offset),
        )
        rows = [
            {"id": r[0], "status": r[1], "error_code": r[2], "song": r[3],
             "label": r[4], "version_number": r[5], "file_path": r[6],
             "analysis_id": r[7], "tier": r[8], "dispatched_at": r[9],
             "completed_at": r[10]}
            for r in cur.fetchall()
        ]
    return {"rows": rows, "total": total, "page": page, "page_size": page_size}
