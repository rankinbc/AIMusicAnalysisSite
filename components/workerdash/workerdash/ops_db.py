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


_JOB_DETAIL_SQL = """
SELECT j.id::text, j.status, coalesce(j.error_code,''), coalesce(j.error_message,''),
       j.current_phase, coalesce(j.tier,''),
       j.dispatched_at::text, j.started_at::text, j.completed_at::text, j.failed_at::text,
       coalesce(s.name,''), coalesce(v.label,''), v.version_number,
       coalesce(v.notes,''), coalesce(v.is_current,false), coalesce(v.stem_analysis_mode,''),
       a.id::text, a.pipeline_version, a.rule_engine_version, a.validator_version,
       a.phase_durations, a.degradation_notice, a.routing_plan
FROM analysis_jobs j
LEFT JOIN song_versions v ON v.id = j.version_id
LEFT JOIN songs s ON s.id = v.song_id
LEFT JOIN analyses a ON a.job_id = j.id
WHERE j.id::text = %s
"""

_VERDICTS_SQL = """
SELECT id, specialist, model, severity, category, headline, summary, created_at::text
FROM verdicts WHERE analysis_id::text = %s ORDER BY created_at
"""

_COACH_TRANSCRIPT_SQL = """
SELECT m.role, m.status, m.content, m.created_at::text,
       coalesce(l.input_tokens, 0), coalesce(l.output_tokens, 0),
       coalesce(l.cost_usd, 0)
FROM coach_messages m
JOIN conversations c ON c.id = m.conversation_id
LEFT JOIN llm_calls l ON l.id = m.llm_call_id
WHERE c.analysis_id::text = %s
ORDER BY m.created_at
"""

_LLM_CALLS_DIRECT_SQL = """
SELECT id, purpose, coalesce(prompt_slug,''), model, input_tokens, output_tokens,
       cost_usd, outcome, created_at::text
FROM llm_calls WHERE correlation_id = %s
"""

_LLM_CALLS_COACH_SQL = """
SELECT l.id, l.purpose, coalesce(l.prompt_slug,''), l.model, l.input_tokens,
       l.output_tokens, l.cost_usd, l.outcome, l.created_at::text
FROM llm_calls l
JOIN conversations c ON c.id::text = l.correlation_id
WHERE c.analysis_id::text = %s
"""


def _llm_call_rows(conn, analysis_id):
    rows = []
    with conn.cursor() as cur:
        cur.execute(_LLM_CALLS_DIRECT_SQL, (analysis_id,))
        rows.extend(cur.fetchall())
    with conn.cursor() as cur:
        cur.execute(_LLM_CALLS_COACH_SQL, (analysis_id,))
        rows.extend(cur.fetchall())
    rows.sort(key=lambda r: r[8])
    return [
        {"id": r[0], "purpose": r[1], "prompt_slug": r[2], "model": r[3],
         "input_tokens": r[4], "output_tokens": r[5], "cost_usd": float(r[6]),
         "outcome": r[7], "created_at": r[8]}
        for r in rows
    ]


def job_detail(conn, job_id):
    with conn.cursor() as cur:
        cur.execute(_JOB_DETAIL_SQL, (job_id,))
        row = cur.fetchone()
    if row is None:
        return None

    (jid, status, error_code, error_message, current_phase, tier,
     dispatched_at, started_at, completed_at, failed_at,
     song_name, label, version_number, notes, is_current, stem_mode,
     analysis_id, pipeline_version, rule_engine_version, validator_version,
     phase_durations, degradation_notice, routing_plan) = row

    verdicts, coach_transcript, llm_calls = [], [], []
    if analysis_id:
        with conn.cursor() as cur:
            cur.execute(_VERDICTS_SQL, (analysis_id,))
            verdicts = [
                {"id": r[0], "specialist": r[1], "model": r[2], "severity": r[3],
                 "category": r[4], "headline": r[5], "summary": r[6], "created_at": r[7]}
                for r in cur.fetchall()
            ]
        with conn.cursor() as cur:
            cur.execute(_COACH_TRANSCRIPT_SQL, (analysis_id,))
            coach_transcript = [
                {"role": r[0], "status": r[1], "content": r[2], "created_at": r[3],
                 "input_tokens": r[4], "output_tokens": r[5], "cost_usd": float(r[6])}
                for r in cur.fetchall()
            ]
        llm_calls = _llm_call_rows(conn, analysis_id)

    totals = llm_totals_by_analysis(conn, [analysis_id] if analysis_id else [])
    files = file_slots(conn, job_id) or {}

    return {
        "job": {"id": jid, "status": status, "error_code": error_code,
                "error_message": error_message, "current_phase": current_phase,
                "tier": tier, "dispatched_at": dispatched_at, "started_at": started_at,
                "completed_at": completed_at, "failed_at": failed_at},
        "song": {"name": song_name, "label": label, "version_number": version_number,
                 "notes": notes, "is_current": is_current, "stem_analysis_mode": stem_mode},
        "analysis": None if not analysis_id else {
            "id": analysis_id, "pipeline_version": pipeline_version,
            "rule_engine_version": rule_engine_version,
            "validator_version": validator_version,
            "phase_durations": phase_durations,
            "degradation_notice": degradation_notice,
            "routing_plan": routing_plan,
        },
        "totals": totals.get(analysis_id, ZERO_TOTALS),
        "llm_calls": llm_calls,
        "verdicts": verdicts,
        "coach_transcript": coach_transcript,
        "files": files,
    }


def analysis_final_json(conn, job_id):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT a.final_json FROM analysis_jobs j "
            "JOIN analyses a ON a.job_id = j.id WHERE j.id::text = %s",
            (job_id,),
        )
        row = cur.fetchone()
    return row[0] if row else None
