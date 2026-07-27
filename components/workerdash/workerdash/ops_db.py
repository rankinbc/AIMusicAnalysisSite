"""Operations-tab Postgres reads: run history, drill-down detail, and the
token/cost rollup. Kept separate from db.py, which stays scoped to the
live queue/job-mutation queries workerdash already had."""


ZERO_TOTALS = {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0, "call_count": 0}

_DIRECT_LLM_SQL = """
SELECT correlation_id, sum(input_tokens), sum(output_tokens), sum(cost_usd), count(*)
FROM llm_calls
WHERE correlation_id = ANY(%s)
GROUP BY correlation_id
"""

_COACH_LLM_SQL = """
SELECT c.analysis_id::text, sum(l.input_tokens), sum(l.output_tokens),
       sum(l.cost_usd), count(*)
FROM llm_calls l
JOIN conversations c ON c.id::text = l.correlation_id
WHERE c.analysis_id::text = ANY(%s)
GROUP BY c.analysis_id
"""


def _merge_totals(into, rows):
    for analysis_id, in_tok, out_tok, cost, count in rows:
        acc = into.setdefault(analysis_id, dict(ZERO_TOTALS))
        acc["input_tokens"] += in_tok or 0
        acc["output_tokens"] += out_tok or 0
        acc["cost_usd"] = round(acc["cost_usd"] + float(cost or 0), 6)
        acc["call_count"] += count or 0


def llm_totals_by_analysis(conn, analysis_ids):
    ids = [a for a in analysis_ids if a]
    if not ids:
        return {}
    totals = {}
    with conn.cursor() as cur:
        cur.execute(_DIRECT_LLM_SQL, (ids,))
        _merge_totals(totals, cur.fetchall())
        cur.execute(_COACH_LLM_SQL, (ids,))
        _merge_totals(totals, cur.fetchall())
    return totals


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

    analysis_ids = [r["analysis_id"] for r in rows if r["analysis_id"]]
    totals = llm_totals_by_analysis(conn, analysis_ids)
    for r in rows:
        t = totals.get(r["analysis_id"], ZERO_TOTALS)
        r["input_tokens"] = t["input_tokens"]
        r["output_tokens"] = t["output_tokens"]
        r["cost_usd"] = t["cost_usd"]

    return {"rows": rows, "total": total, "page": page, "page_size": page_size}


_FILE_SLOTS_SQL = """
SELECT v.file_path, v.reference_path, v.als_file_path, v.stem_paths,
       v.raw_audio_purged_at::text,
       a.waveform_image_path, a.spectrogram_image_path, a.waveform_peaks_path,
       j.file_path
FROM analysis_jobs j
LEFT JOIN song_versions v ON v.id = j.version_id
LEFT JOIN analyses a ON a.job_id = j.id
WHERE j.id::text = %s
"""


def _slot(key, label, purged=False, download=False):
    return {"key": key, "label": label, "purged": purged, "download": download}


def file_slots(conn, job_id):
    with conn.cursor() as cur:
        cur.execute(_FILE_SLOTS_SQL, (job_id,))
        row = cur.fetchone()
    if row is None:
        return None
    (v_file, v_ref, v_als, stem_paths, purged_at,
     wf_image, spec_image, peaks, job_file) = row

    purged = bool(purged_at)
    source_key = v_file if v_file else job_file
    slots = {
        "source": _slot(None if purged else source_key, "Source audio", purged=purged),
        "reference": _slot(None if purged else v_ref, "Reference track", purged=purged),
        "als": _slot(None if purged else v_als, "Ableton project", download=True, purged=purged),
        "waveform_image": _slot(wf_image, "Waveform image"),
        "spectrogram_image": _slot(spec_image, "Spectrogram image"),
        "waveform_peaks": _slot(peaks, "Waveform peaks (JSON)", download=True),
    }
    for role, entry in (stem_paths or {}).items():
        if isinstance(entry, list):
            for i, key in enumerate(entry):
                slots[f"stem:{role}:{i}"] = _slot(None if purged else key, f"Stem: {role} ({i})", purged=purged)
        else:
            slots[f"stem:{role}"] = _slot(None if purged else entry, f"Stem: {role}", purged=purged)
    return slots


def job_analysis_id(conn, job_id):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT a.id::text FROM analysis_jobs j "
            "LEFT JOIN analyses a ON a.job_id = j.id WHERE j.id::text = %s",
            (job_id,),
        )
        row = cur.fetchone()
    return row[0] if row else None
