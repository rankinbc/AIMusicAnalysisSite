# workerdash Operations Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Operations" tab to workerdash showing every upload/analysis run (paginated, searchable), with a drill-down detail view listing every related file (served, not just a path), the full JSON report, and token/dollar cost broken down per LLM call.

**Architecture:** Two new backend modules (`ops_db.py` for Postgres queries, `files.py` for local/S3 file resolution) plus four new Flask routes on the existing `create_app()`, plus a second tab added to the existing single-page `PAGE` constant's inline HTML/JS. No changes to the BFF, frontend-spectr-v2, or worker.

**Tech Stack:** Python 3.11+, Flask, psycopg2, boto3 (lazy-imported, S3 optional), vanilla JS (no build step, no framework) — same as the rest of workerdash.

## Global Constraints

- No auth, no HTTPS — every route stays behind the existing host/origin guard (`app.py`'s `_reject_cross_origin`), localhost-only by design.
- No new runtime dependency beyond `boto3>=1.34` (lazy-imported, mirrors `components/worker/requirements.txt`'s existing convention) — do not add a frontend build step or JS framework.
- Every new query function degrades to an explicit error shape (`{"error": ...}` or `None`) rather than raising past its route handler — matches `db.py`'s existing `db_section()` pattern.
- `workerdash` must stay independently installable; do not import from `components/worker` — file-resolution logic mirrors `components/worker/app/object_store.py`'s algorithm but is a separate, standalone implementation.
- Column names follow the EF snake_case schema (see `components/shared/aimusic_shared/models.py`) — verified against the actual model source in this plan, not guessed.

---

## Task 1: `ops_db.list_jobs` — paginated, filterable run list

**Files:**
- Create: `components/workerdash/workerdash/ops_db.py`
- Test: `components/workerdash/tests/test_ops_db.py`

**Interfaces:**
- Produces: `list_jobs(conn, search=None, status=None, since=None, until=None, page=1, page_size=25) -> dict` with shape `{"rows": [ {id, status, error_code, song, label, version_number, file_path, analysis_id, tier, dispatched_at, completed_at}, ... ], "total": int, "page": int, "page_size": int}`. `song`/`label` are `""` when the job has no version (anonymous upload) — the frontend falls back to `file_path` in that case.

- [ ] **Step 1: Write the failing tests**

```python
# components/workerdash/tests/test_ops_db.py
from workerdash import ops_db


class FakeCursor:
    """Returns one canned result set per execute() call, matched by call order."""
    def __init__(self, result_sets):
        self.result_sets = list(result_sets)
        self.executed = []
        self._current = None

    def execute(self, sql, params=None):
        self.executed.append((" ".join(sql.split()), params))
        self._current = self.result_sets.pop(0) if self.result_sets else []

    def fetchall(self):
        return self._current

    def fetchone(self):
        return self._current[0] if self._current else None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeConn:
    def __init__(self, result_sets):
        self.cur = FakeCursor(result_sets)

    def cursor(self):
        return self.cur


def test_list_jobs_maps_rows_and_total():
    rows = [("j1", "complete", "", "22", "5_bb", 3, "", "a1")]
    conn = FakeConn([[(7,)], rows])  # first query: COUNT, second: page rows
    result = ops_db.list_jobs(conn, page=1, page_size=25)
    assert result["total"] == 7
    assert result["rows"] == [{
        "id": "j1", "status": "complete", "error_code": "",
        "song": "22", "label": "5_bb", "version_number": 3,
        "file_path": "", "analysis_id": "a1",
    }]
    assert result["page"] == 1
    assert result["page_size"] == 25


def test_list_jobs_anonymous_job_uses_file_path():
    rows = [("j2", "processing", "", "", "", None, "audio/anon/dev1/j2/source.wav", None)]
    conn = FakeConn([[(1,)], rows])
    result = ops_db.list_jobs(conn)
    assert result["rows"][0]["song"] == ""
    assert result["rows"][0]["file_path"] == "audio/anon/dev1/j2/source.wav"


def test_list_jobs_search_filters_by_song_and_label():
    conn = FakeConn([[(0,)], []])
    ops_db.list_jobs(conn, search="eterna")
    count_sql, count_params = conn.cur.executed[0]
    assert "ILIKE" in count_sql
    assert any("%eterna%" in str(p) for p in count_params)


def test_list_jobs_status_filter():
    conn = FakeConn([[(0,)], []])
    ops_db.list_jobs(conn, status="failed")
    count_sql, count_params = conn.cur.executed[0]
    assert "j.status = %s" in count_sql
    assert "failed" in count_params


def test_list_jobs_date_range_filter():
    conn = FakeConn([[(0,)], []])
    ops_db.list_jobs(conn, since="2026-07-01", until="2026-07-27")
    count_sql, count_params = conn.cur.executed[0]
    assert "j.dispatched_at >= %s" in count_sql
    assert "j.dispatched_at <= %s" in count_sql
    assert "2026-07-01" in count_params
    assert "2026-07-27" in count_params


def test_list_jobs_pagination_uses_offset():
    conn = FakeConn([[(100,)], []])
    ops_db.list_jobs(conn, page=3, page_size=10)
    page_sql, page_params = conn.cur.executed[1]
    assert "LIMIT %s OFFSET %s" in page_sql
    assert page_params[-2:] == (10, 20)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd components/workerdash && python -m pytest tests/test_ops_db.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'workerdash.ops_db'`

- [ ] **Step 3: Write the implementation**

```python
# components/workerdash/workerdash/ops_db.py
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
                   coalesce(j.file_path,''), a.id::text
            {_FROM}{clause}
            ORDER BY j.dispatched_at DESC
            LIMIT %s OFFSET %s
            """,
            params + [page_size, offset],
        )
        rows = [
            {"id": r[0], "status": r[1], "error_code": r[2], "song": r[3],
             "label": r[4], "version_number": r[5], "file_path": r[6],
             "analysis_id": r[7]}
            for r in cur.fetchall()
        ]
    return {"rows": rows, "total": total, "page": page, "page_size": page_size}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd components/workerdash && python -m pytest tests/test_ops_db.py -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
cd components/workerdash
git add workerdash/ops_db.py tests/test_ops_db.py
git commit -m "feat(workerdash): ops_db.list_jobs — paginated, filterable run history"
```

---

## Task 2: `ops_db.llm_totals_by_analysis` — token/cost rollup, wired into `list_jobs`

**Files:**
- Modify: `components/workerdash/workerdash/ops_db.py`
- Modify: `components/workerdash/tests/test_ops_db.py`

**Interfaces:**
- Consumes: `list_jobs` (Task 1) — this task's last step amends it in place.
- Produces: `llm_totals_by_analysis(conn, analysis_ids: list[str]) -> dict[str, dict]` — `{analysis_id: {"input_tokens": int, "output_tokens": int, "cost_usd": float, "call_count": int}}`. Analysis ids with zero calls are simply absent from the returned dict (callers use `.get(id, ZERO_TOTALS)`).
- Produces: `ZERO_TOTALS = {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0, "call_count": 0}` (module-level constant, used by this task and Tasks 3-4).
- Produces (amended): `list_jobs`'s returned rows now each carry `input_tokens`, `output_tokens`, `cost_usd` — the per-row token/cost figures the Operations list table (Task 9) displays.

**Why two queries merged in Python:** traced in `components/worker/app/triage_actor.py:135-140`, `verdict_actor.py:232-237`, `fix_rack_actor.py:63`, and `coach_actor.py:326-528` — `llm_calls.correlation_id` is the analysis id directly for triage/specialist/fix_rack calls, but the *conversation* id for coach calls (`conversations.analysis_id` links back). There is no single SQL join that covers both without this two-query merge.

- [ ] **Step 1: Write the failing tests**

```python
# append to components/workerdash/tests/test_ops_db.py

def test_llm_totals_merges_direct_and_coach_calls():
    # first query: direct correlation_id = analysis_id rows
    direct_rows = [("a1", 1000, 200, 0.05, 3)]
    # second query: via conversations (coach)
    coach_rows = [("a1", 500, 100, 0.02, 1)]
    conn = FakeConn([direct_rows, coach_rows])
    totals = ops_db.llm_totals_by_analysis(conn, ["a1"])
    assert totals["a1"] == {
        "input_tokens": 1500, "output_tokens": 300,
        "cost_usd": 0.07, "call_count": 4,
    }


def test_llm_totals_empty_ids_no_query():
    conn = FakeConn([])
    assert ops_db.llm_totals_by_analysis(conn, []) == {}
    assert conn.cur.executed == []


def test_llm_totals_analysis_with_no_calls_absent_from_result():
    conn = FakeConn([[], []])
    totals = ops_db.llm_totals_by_analysis(conn, ["a1"])
    assert totals == {}


def test_list_jobs_includes_token_totals(monkeypatch):
    rows = [("j1", "complete", "", "22", "5_bb", 3, "", "a1")]
    conn = FakeConn([[(1,)], rows])
    monkeypatch.setattr(ops_db, "llm_totals_by_analysis",
                         lambda c, ids: {"a1": {"input_tokens": 500, "output_tokens": 100,
                                                 "cost_usd": 0.02, "call_count": 2}})
    result = ops_db.list_jobs(conn)
    assert result["rows"][0]["input_tokens"] == 500
    assert result["rows"][0]["output_tokens"] == 100
    assert result["rows"][0]["cost_usd"] == 0.02


def test_list_jobs_row_with_no_analysis_gets_zero_totals(monkeypatch):
    rows = [("j2", "processing", "", "", "", None, "audio/anon/x.wav", None)]
    conn = FakeConn([[(1,)], rows])
    monkeypatch.setattr(ops_db, "llm_totals_by_analysis", lambda c, ids: {})
    result = ops_db.list_jobs(conn)
    assert result["rows"][0]["input_tokens"] == 0
    assert result["rows"][0]["cost_usd"] == 0.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd components/workerdash && python -m pytest tests/test_ops_db.py -k "llm_totals or list_jobs_includes_token or list_jobs_row_with_no" -v`
Expected: FAIL — `llm_totals_by_analysis` doesn't exist yet, and `list_jobs`'s rows don't have `input_tokens` yet

- [ ] **Step 3: Write the implementation**

```python
# append to components/workerdash/workerdash/ops_db.py

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
WHERE c.analysis_id = ANY(%s)
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
```

Now amend `list_jobs` (Task 1) to attach each row's totals. Replace its final line —
`return {"rows": rows, "total": total, "page": page, "page_size": page_size}` — with:

```python
    analysis_ids = [r["analysis_id"] for r in rows if r["analysis_id"]]
    totals = llm_totals_by_analysis(conn, analysis_ids)
    for r in rows:
        t = totals.get(r["analysis_id"], ZERO_TOTALS)
        r["input_tokens"] = t["input_tokens"]
        r["output_tokens"] = t["output_tokens"]
        r["cost_usd"] = t["cost_usd"]

    return {"rows": rows, "total": total, "page": page, "page_size": page_size}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd components/workerdash && python -m pytest tests/test_ops_db.py -v`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
cd components/workerdash
git add workerdash/ops_db.py tests/test_ops_db.py
git commit -m "feat(workerdash): ops_db.llm_totals_by_analysis — merged direct+coach token rollup, wired into list_jobs"
```

---

## Task 3: `ops_db.file_slots` — resolve a run's file inventory

**Files:**
- Modify: `components/workerdash/workerdash/ops_db.py`
- Modify: `components/workerdash/tests/test_ops_db.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `file_slots(conn, job_id: str) -> dict[str, dict] | None`. Returns `None` if the job doesn't exist. Otherwise a dict keyed by slot name, each value `{"key": str|None, "label": str, "purged": bool, "download": bool}`. Slot keys: `source`, `reference`, `als`, `stem:<role>` (or `stem:<role>:<i>` when a role has multiple stem files), `waveform_image`, `spectrogram_image`, `waveform_peaks`. A slot with `"key": None` means "not available for this run" (frontend renders it disabled) — this is distinct from `"purged": True`, which means the key existed but the file was swept by retention.
- Produces: `job_analysis_id(conn, job_id) -> str | None` — small helper used by Task 4's serving route to re-derive the analysis id without duplicating `file_slots`' query. (Not needed by `file_slots` itself, but Task 4 needs it and it belongs next to this query.)

**Verified against `components/shared/aimusic_shared/models.py`:** `song_versions.stem_paths` is `{role: [key,...]}` or legacy `{role: "key"}` (confirmed in `components/worker/app/tasks_dramatiq.py:283-296`) — flatten list-valued roles into `stem:<role>:<i>` slots, string-valued roles into a single `stem:<role>` slot.

- [ ] **Step 1: Write the failing tests**

```python
# append to components/workerdash/tests/test_ops_db.py

def test_file_slots_full_version_row():
    row = ("v1.wav", "ref.wav", "proj.als",
           {"drums": "stems/drums.wav", "bass": ["stems/bass_l.wav", "stems/bass_r.wav"]},
           None,  # raw_audio_purged_at
           "wf.webp", "spec.webp", "peaks.json")
    conn = FakeConn([[row]])
    slots = ops_db.file_slots(conn, "j1")
    assert slots["source"] == {"key": "v1.wav", "label": "Source audio",
                                "purged": False, "download": False}
    assert slots["reference"]["key"] == "ref.wav"
    assert slots["als"] == {"key": "proj.als", "label": "Ableton project",
                             "purged": False, "download": True}
    assert slots["stem:drums"]["key"] == "stems/drums.wav"
    assert slots["stem:bass:0"]["key"] == "stems/bass_l.wav"
    assert slots["stem:bass:1"]["key"] == "stems/bass_r.wav"
    assert slots["waveform_image"]["key"] == "wf.webp"
    assert slots["spectrogram_image"]["key"] == "spec.webp"
    assert slots["waveform_peaks"] == {"key": "peaks.json", "label": "Waveform peaks (JSON)",
                                        "purged": False, "download": True}


def test_file_slots_purged_source_marked_not_fetched():
    row = ("v1.wav", None, None, None, "2026-07-01T00:00:00Z", None, None, None)
    conn = FakeConn([[row]])
    slots = ops_db.file_slots(conn, "j1")
    assert slots["source"]["purged"] is True


def test_file_slots_anonymous_job_no_version():
    # job.file_path used when version_id is null (story 6.3 anon jobs)
    conn = FakeConn([[(None, None, None, None, None, None, None, None, "anon/j1/source.wav")]])
    slots = ops_db.file_slots(conn, "j1")
    assert slots["source"]["key"] == "anon/j1/source.wav"


def test_file_slots_missing_job_returns_none():
    conn = FakeConn([[]])
    assert ops_db.file_slots(conn, "nope") is None


def test_job_analysis_id_returns_id_or_none():
    conn = FakeConn([[("a1",)]])
    assert ops_db.job_analysis_id(conn, "j1") == "a1"
    conn2 = FakeConn([[]])
    assert ops_db.job_analysis_id(conn2, "j1") is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd components/workerdash && python -m pytest tests/test_ops_db.py -k "file_slots or job_analysis_id" -v`
Expected: FAIL with `AttributeError: module 'workerdash.ops_db' has no attribute 'file_slots'`

- [ ] **Step 3: Write the implementation**

```python
# append to components/workerdash/workerdash/ops_db.py

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
        "reference": _slot(v_ref, "Reference track"),
        "als": _slot(v_als, "Ableton project", download=True),
        "waveform_image": _slot(wf_image, "Waveform image"),
        "spectrogram_image": _slot(spec_image, "Spectrogram image"),
        "waveform_peaks": _slot(peaks, "Waveform peaks (JSON)", download=True),
    }
    for role, entry in (stem_paths or {}).items():
        if isinstance(entry, list):
            for i, key in enumerate(entry):
                slots[f"stem:{role}:{i}"] = _slot(key, f"Stem: {role} ({i})")
        else:
            slots[f"stem:{role}"] = _slot(entry, f"Stem: {role}")
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd components/workerdash && python -m pytest tests/test_ops_db.py -v`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
cd components/workerdash
git add workerdash/ops_db.py tests/test_ops_db.py
git commit -m "feat(workerdash): ops_db.file_slots — per-run file inventory with purge/download flags"
```

---

## Task 4: `ops_db.job_detail` — full drill-down payload

**Files:**
- Modify: `components/workerdash/workerdash/ops_db.py`
- Modify: `components/workerdash/tests/test_ops_db.py`

**Interfaces:**
- Consumes: `ZERO_TOTALS`, `llm_totals_by_analysis` (Task 2), `file_slots` (Task 3).
- Produces: `job_detail(conn, job_id: str) -> dict | None`. Returns `None` if the job doesn't exist (route turns this into 404). Shape:
  ```
  {
    "job": {id, status, error_code, error_message, current_phase, tier,
            dispatched_at, started_at, completed_at, failed_at},
    "song": {name, label, version_number, notes, is_current, stem_analysis_mode},
    "analysis": {id, pipeline_version, rule_engine_version, validator_version,
                 phase_durations, degradation_notice, routing_plan} | None,
    "totals": {input_tokens, output_tokens, cost_usd, call_count},
    "llm_calls": [ {id, purpose, prompt_slug, model, input_tokens,
                     output_tokens, cost_usd, outcome, created_at}, ... ],
    "verdicts": [ {id, specialist, model, severity, category, headline,
                    summary, created_at}, ... ],
    "coach_transcript": [ {role, status, content, created_at,
                            input_tokens, output_tokens, cost_usd}, ... ],
    "files": <output of file_slots(conn, job_id)>,
  }
  ```
  `coach_transcript` rows join `coach_messages.llm_call_id` (confirmed present on the model — `components/shared/aimusic_shared/models.py:577`) back to `llm_calls` for an exact per-turn token/cost figure; rows are `None`/0 when the turn short-circuited without a gateway call (coach_offline/budget refusal).

- [ ] **Step 1: Write the failing tests**

```python
# append to components/workerdash/tests/test_ops_db.py

class MultiFakeConn:
    """Like FakeConn but exposes distinct cursors per call — job_detail
    issues several independent queries and needs each to return its own
    canned rows regardless of call order within a single cursor context."""
    def __init__(self, result_sets):
        self.result_sets = list(result_sets)

    def cursor(self):
        rows = self.result_sets.pop(0) if self.result_sets else []
        return FakeCursor([rows])


def test_job_detail_missing_job_returns_none():
    conn = MultiFakeConn([[]])  # job row query returns nothing
    assert ops_db.job_detail(conn, "nope") is None


def test_job_detail_assembles_full_payload(monkeypatch):
    job_row = [("j1", "complete", "", "", "phase6", "pro",
                "2026-07-27T00:00:00Z", "2026-07-27T00:01:00Z",
                "2026-07-27T00:05:00Z", None,
                "22", "5_bb", 3, "notes", True, "grouped", "a1",
                "v3", "r1", "val1", {"phase1": 1.2}, None, None)]
    verdict_rows = [("vrd_1", "low_end", "opus", "warn", "eq", "Headline", "Summary",
                      "2026-07-27T00:02:00Z")]
    coach_rows = [("assistant", "complete", "hi", "2026-07-27T00:03:00Z",
                   100, 20, 0.001)]
    direct_call_rows = [("call1", "specialist", "low_end", "opus", 900, 180, 0.05,
                          "success", "2026-07-27T00:02:00Z")]
    coach_call_rows = [("call2", "coach", "coach_grounded", "opus", 100, 20, 0.001,
                         "success", "2026-07-27T00:03:00Z")]

    conn = MultiFakeConn([job_row, verdict_rows, coach_rows,
                           direct_call_rows, coach_call_rows])
    monkeypatch.setattr(ops_db, "llm_totals_by_analysis",
                         lambda c, ids: {"a1": {"input_tokens": 1500, "output_tokens": 300,
                                                 "cost_usd": 0.07, "call_count": 4}})
    monkeypatch.setattr(ops_db, "file_slots", lambda c, jid: {"source": {"key": "v1.wav"}})

    detail = ops_db.job_detail(conn, "j1")
    assert detail["job"]["id"] == "j1"
    assert detail["song"]["name"] == "22"
    assert detail["analysis"]["pipeline_version"] == "v3"
    assert detail["totals"]["input_tokens"] == 1500
    assert detail["verdicts"][0]["specialist"] == "low_end"
    assert detail["coach_transcript"][0]["content"] == "hi"
    assert detail["files"] == {"source": {"key": "v1.wav"}}
    assert [c["id"] for c in detail["llm_calls"]] == ["call1", "call2"]
    assert detail["llm_calls"][0]["prompt_slug"] == "low_end"


def test_job_detail_no_analysis_yet_zero_totals(monkeypatch):
    job_row = [("j1", "processing", "", "", "phase2", "free",
                "2026-07-27T00:00:00Z", "2026-07-27T00:01:00Z", None, None,
                "22", "5_bb", 3, "", False, "grouped", None,
                None, None, None, {}, None, None)]
    conn = MultiFakeConn([job_row])
    monkeypatch.setattr(ops_db, "llm_totals_by_analysis", lambda c, ids: {})
    monkeypatch.setattr(ops_db, "file_slots", lambda c, jid: {})

    detail = ops_db.job_detail(conn, "j1")
    assert detail["analysis"] is None
    assert detail["totals"] == ops_db.ZERO_TOTALS
    assert detail["verdicts"] == []
    assert detail["coach_transcript"] == []
    assert detail["llm_calls"] == []
```

Note: `test_job_detail_no_analysis_yet_zero_totals` supplies only one result set — `job_detail`'s implementation below only issues the verdicts/coach/llm-calls queries when `analysis_id` is truthy, so a job with no analysis yet never reaches those cursors.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd components/workerdash && python -m pytest tests/test_ops_db.py -k job_detail -v`
Expected: FAIL with `AttributeError: module 'workerdash.ops_db' has no attribute 'job_detail'`

- [ ] **Step 3: Write the implementation**

```python
# append to components/workerdash/workerdash/ops_db.py

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
FROM verdicts WHERE analysis_id = %s ORDER BY created_at
"""

_COACH_TRANSCRIPT_SQL = """
SELECT m.role, m.status, m.content, m.created_at::text,
       coalesce(l.input_tokens, 0), coalesce(l.output_tokens, 0),
       coalesce(l.cost_usd, 0)
FROM coach_messages m
JOIN conversations c ON c.id = m.conversation_id
LEFT JOIN llm_calls l ON l.id = m.llm_call_id
WHERE c.analysis_id = %s
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
WHERE c.analysis_id = %s
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd components/workerdash && python -m pytest tests/test_ops_db.py -v`
Expected: PASS (16 tests)

- [ ] **Step 5: Commit**

```bash
cd components/workerdash
git add workerdash/ops_db.py tests/test_ops_db.py
git commit -m "feat(workerdash): ops_db.job_detail — full drill-down payload with per-call token breakdown"
```

---

## Task 5: `files.py` — local/S3 file resolution and content-typing

**Files:**
- Create: `components/workerdash/workerdash/files.py`
- Test: `components/workerdash/tests/test_files.py`
- Modify: `components/workerdash/pyproject.toml`

**Interfaces:**
- Produces: `local_root() -> str`, `s3_enabled() -> bool`, `resolve(path_or_key: str) -> tuple[Path|None, Path|None]` (returns `(path_to_serve, temp_path_to_cleanup)`, both `None` if unresolvable), `cleanup(temp_path: Path|None) -> None`, `content_type_for(path: Path) -> str`.

**Verified against `components/worker/app/object_store.py:75-102`** — this reimplements the same local-first-then-S3 algorithm (candidate under `local_root`, then absolute-path check, then S3 fetch-to-temp) without importing the worker package, per the Global Constraints. `STORAGE_LOCAL_ROOT` default mirrors `components/worker/app/tasks_dramatiq.py:48-64`'s Windows-dev fallback (repo-root `data/` dir) — `components/workerdash/workerdash/files.py` sits at the same depth from repo root (`parents[3]`) as `components/worker/app/tasks_dramatiq.py`, so the identical `parents[3]` computation lands on the same directory.

- [ ] **Step 1: Write the failing tests**

```python
# components/workerdash/tests/test_files.py
import os
from pathlib import Path

import pytest

from workerdash import files


def test_local_root_uses_env_override(monkeypatch):
    monkeypatch.setenv("STORAGE_LOCAL_ROOT", "/custom/root")
    assert files.local_root() == "/custom/root"


def test_local_root_defaults_to_repo_data_dir(monkeypatch):
    monkeypatch.delenv("STORAGE_LOCAL_ROOT", raising=False)
    root = Path(files.local_root())
    assert root.name == "data"


def test_s3_enabled_reflects_env(monkeypatch):
    monkeypatch.delenv("S3_ENDPOINT", raising=False)
    assert files.s3_enabled() is False
    monkeypatch.setenv("S3_ENDPOINT", "http://minio:9000")
    assert files.s3_enabled() is True


def test_resolve_local_root_hit(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_LOCAL_ROOT", str(tmp_path))
    (tmp_path / "song.wav").write_bytes(b"data")
    path, temp = files.resolve("song.wav")
    assert path == (tmp_path / "song.wav").resolve()
    assert temp is None


def test_resolve_absolute_path_hit(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_LOCAL_ROOT", str(tmp_path / "nonexistent"))
    abs_file = tmp_path / "elsewhere.wav"
    abs_file.write_bytes(b"data")
    path, temp = files.resolve(str(abs_file))
    assert path == abs_file
    assert temp is None


def test_resolve_rejects_path_traversal(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_LOCAL_ROOT", str(tmp_path))
    path, temp = files.resolve("../../etc/passwd")
    assert path is None and temp is None


def test_resolve_missing_file_no_s3_returns_none(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_LOCAL_ROOT", str(tmp_path))
    monkeypatch.delenv("S3_ENDPOINT", raising=False)
    path, temp = files.resolve("missing.wav")
    assert path is None and temp is None


def test_resolve_falls_back_to_s3(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_LOCAL_ROOT", str(tmp_path))
    monkeypatch.setenv("S3_ENDPOINT", "http://minio:9000")

    class FakeClient:
        def download_file(self, bucket, key, target):
            Path(target).write_bytes(b"fetched")

    monkeypatch.setattr(files, "_s3_client", lambda: FakeClient())
    path, temp = files.resolve("song.wav")
    assert path is not None and path.read_bytes() == b"fetched"
    assert temp == path
    files.cleanup(temp)
    assert not path.exists()


def test_resolve_s3_download_failure_returns_none(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_LOCAL_ROOT", str(tmp_path))
    monkeypatch.setenv("S3_ENDPOINT", "http://minio:9000")

    class FailingClient:
        def download_file(self, bucket, key, target):
            raise RuntimeError("s3 down")

    monkeypatch.setattr(files, "_s3_client", lambda: FailingClient())
    path, temp = files.resolve("song.wav")
    assert path is None and temp is None


def test_cleanup_none_is_noop():
    files.cleanup(None)  # must not raise


@pytest.mark.parametrize("name,expected", [
    ("song.wav", "audio/wav"), ("mix.mp3", "audio/mpeg"),
    ("stem.flac", "audio/flac"), ("wave.webp", "image/webp"),
    ("peaks.json", "application/json"), ("proj.als", "application/octet-stream"),
    ("unknown.xyz", "application/octet-stream"),
])
def test_content_type_for(name, expected):
    assert files.content_type_for(Path(name)) == expected
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd components/workerdash && python -m pytest tests/test_files.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'workerdash.files'`

- [ ] **Step 3: Write the implementation**

```python
# components/workerdash/workerdash/files.py
"""Local/S3 file resolution for the Operations tab's served-file links.

Reimplements components/worker/app/object_store.py's local-first-then-S3
algorithm standalone (workerdash must not import the worker package — see
plan Global Constraints) so served files behave identically whether the
dev data lives on local disk or a real bucket.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path


def _default_local_root() -> str:
    if os.name == "nt":
        # components/workerdash/workerdash/files.py -> repo root is 3 levels up,
        # same depth as components/worker/app/tasks_dramatiq.py.
        return str(Path(__file__).resolve().parents[3] / "data")
    return "/data"


def local_root() -> str:
    return os.environ.get("STORAGE_LOCAL_ROOT") or _default_local_root()


def s3_enabled() -> bool:
    return bool(os.environ.get("S3_ENDPOINT"))


def _s3_client():
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=os.environ["S3_ENDPOINT"],
        aws_access_key_id=os.environ.get("S3_ACCESS_KEY"),
        aws_secret_access_key=os.environ.get("S3_SECRET_KEY"),
        region_name=os.environ.get("S3_REGION", "auto"),
        config=Config(connect_timeout=5, read_timeout=60, retries={"max_attempts": 2}),
    )


def resolve(path_or_key: str) -> tuple[Path | None, Path | None]:
    """Returns (path_to_serve, temp_path_to_cleanup); both None if unresolvable."""
    if ".." in Path(path_or_key).parts:
        return None, None

    candidate = (Path(local_root()) / path_or_key).resolve()
    if candidate.exists():
        return candidate, None

    p = Path(path_or_key)
    if p.is_absolute() and p.exists():
        return p, None

    if s3_enabled():
        bucket = os.environ.get("S3_BUCKET", "spectr")
        suffix = Path(path_or_key).suffix or ".bin"
        tmp_dir = Path(tempfile.mkdtemp(prefix="workerdash_s3_"))
        target = tmp_dir / f"file{suffix}"
        try:
            _s3_client().download_file(bucket, path_or_key, str(target))
        except Exception:
            return None, None
        return target, target

    return None, None


def cleanup(temp_path: Path | None) -> None:
    if temp_path is None:
        return
    try:
        temp_path.unlink(missing_ok=True)
        temp_path.parent.rmdir()
    except OSError:
        pass


CONTENT_TYPES = {
    ".wav": "audio/wav", ".mp3": "audio/mpeg", ".flac": "audio/flac",
    ".webp": "image/webp", ".png": "image/png", ".json": "application/json",
    ".als": "application/octet-stream",
}


def content_type_for(path: Path) -> str:
    return CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")
```

Add `boto3>=1.34` to `components/workerdash/pyproject.toml`'s `dependencies` list (mirrors `components/worker/requirements.txt:12`'s comment: lazy-imported, only touched when `S3_ENDPOINT` is set, but declared unconditionally for install simplicity):

```toml
dependencies = ["flask>=3", "redis>=5", "psycopg2-binary>=2.9", "boto3>=1.34"]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd components/workerdash && pip install -e ".[dev]" && python -m pytest tests/test_files.py -v`
Expected: PASS (11 tests, 1 parametrized ×7)

- [ ] **Step 5: Commit**

```bash
cd components/workerdash
git add workerdash/files.py tests/test_files.py pyproject.toml
git commit -m "feat(workerdash): files.py — standalone local/S3 file resolution for served links"
```

---

## Task 6: `GET /api/ops` — list route

**Files:**
- Modify: `components/workerdash/workerdash/app.py`
- Modify: `components/workerdash/tests/test_app.py`

**Interfaces:**
- Consumes: `ops_db.list_jobs` (Task 1).
- Produces: `GET /api/ops?search=&status=&since=&until=&page=&page_size=` → `200 {"ok": true, "rows": [...], "total": int, "page": int, "page_size": int}` on success, `200 {"ok": false, "error": str, "rows": [], "total": 0, "page": 1, "page_size": 25}` if the DB is unreachable (same degrade-not-crash pattern as `/api/state`).

- [ ] **Step 1: Write the failing tests**

```python
# append to components/workerdash/tests/test_app.py

def test_ops_list_route_returns_rows(client, monkeypatch):
    import workerdash.app as app_module
    c, r = client
    monkeypatch.setattr(app_module, "ops_dbmod", type("M", (), {
        "list_jobs": staticmethod(lambda conn, **kw: {
            "rows": [{"id": "j1", "status": "complete"}],
            "total": 1, "page": 1, "page_size": 25,
        })
    }))
    res = c.get("/api/ops")
    body = res.get_json()
    assert body["ok"] is True
    assert body["rows"] == [{"id": "j1", "status": "complete"}]
    assert body["total"] == 1


def test_ops_list_route_passes_query_params(client, monkeypatch):
    import workerdash.app as app_module
    c, r = client
    captured = {}

    def fake_list_jobs(conn, **kw):
        captured.update(kw)
        return {"rows": [], "total": 0, "page": 1, "page_size": 25}

    monkeypatch.setattr(app_module, "ops_dbmod",
                         type("M", (), {"list_jobs": staticmethod(fake_list_jobs)}))
    c.get("/api/ops?search=eterna&status=failed&page=2&page_size=10")
    assert captured == {"search": "eterna", "status": "failed", "since": None,
                         "until": None, "page": 2, "page_size": 10}


def test_ops_list_route_db_down_degrades(client, monkeypatch):
    import workerdash.app as app_module
    c, r = client

    class Boom:
        def connect(self):
            raise RuntimeError("db down")

    monkeypatch.setattr(app_module, "dbmod", type("M", (), {
        "connect": staticmethod(lambda: (_ for _ in ()).throw(RuntimeError("db down")))
    }))
    res = c.get("/api/ops")
    body = res.get_json()
    assert body["ok"] is False
    assert "db down" in body["error"]
    assert body["rows"] == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd components/workerdash && python -m pytest tests/test_app.py -k ops_list -v`
Expected: FAIL with 404 (route doesn't exist yet)

- [ ] **Step 3: Write the implementation**

In `components/workerdash/workerdash/app.py`, add the import alongside the existing ones and a new route inside `create_app()`:

```python
from . import ops_db as ops_dbmod
```

```python
@app.get("/api/ops")
def ops_list():
    args = request.args
    page = int(args.get("page", 1))
    page_size = int(args.get("page_size", 25))
    kwargs = {
        "search": args.get("search") or None,
        "status": args.get("status") or None,
        "since": args.get("since") or None,
        "until": args.get("until") or None,
        "page": page,
        "page_size": page_size,
    }
    conn = None
    try:
        conn = connect()
        result = ops_dbmod.list_jobs(conn, **kwargs)
        return jsonify({"ok": True, **result})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e), "rows": [],
                         "total": 0, "page": page, "page_size": page_size})
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd components/workerdash && python -m pytest tests/test_app.py -v`
Expected: PASS (all existing + 3 new)

- [ ] **Step 5: Commit**

```bash
cd components/workerdash
git add workerdash/app.py tests/test_app.py
git commit -m "feat(workerdash): GET /api/ops — paginated run list route"
```

---

## Task 7: `GET /api/ops/<job_id>` — detail route

**Files:**
- Modify: `components/workerdash/workerdash/app.py`
- Modify: `components/workerdash/tests/test_app.py`

**Interfaces:**
- Consumes: `ops_db.job_detail` (Task 4).
- Produces: `GET /api/ops/<job_id>` → `200 {"ok": true, **job_detail_payload}` if found, `404 {"ok": false, "error": "not found"}` if `job_detail` returns `None`, `200 {"ok": false, "error": str}` if the DB is unreachable.

- [ ] **Step 1: Write the failing tests**

```python
# append to components/workerdash/tests/test_app.py

def test_ops_detail_route_returns_payload(client, monkeypatch):
    import workerdash.app as app_module
    c, r = client
    monkeypatch.setattr(app_module, "ops_dbmod", type("M", (), {
        "job_detail": staticmethod(lambda conn, jid: {"job": {"id": jid}, "totals": {}})
    }))
    res = c.get("/api/ops/j1")
    body = res.get_json()
    assert body["ok"] is True
    assert body["job"]["id"] == "j1"


def test_ops_detail_route_missing_job_404(client, monkeypatch):
    import workerdash.app as app_module
    c, r = client
    monkeypatch.setattr(app_module, "ops_dbmod",
                         type("M", (), {"job_detail": staticmethod(lambda conn, jid: None)}))
    res = c.get("/api/ops/nope")
    assert res.status_code == 404
    assert res.get_json()["ok"] is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd components/workerdash && python -m pytest tests/test_app.py -k ops_detail -v`
Expected: FAIL with 404 on the first test too (route doesn't exist) — confirm the failure is "route missing" not an assertion mismatch by checking the response is HTML, not JSON.

- [ ] **Step 3: Write the implementation**

```python
@app.get("/api/ops/<job_id>")
def ops_detail(job_id):
    conn = None
    try:
        conn = connect()
        detail = ops_dbmod.job_detail(conn, job_id)
        if detail is None:
            return jsonify({"ok": False, "error": "not found"}), 404
        return jsonify({"ok": True, **detail})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd components/workerdash && python -m pytest tests/test_app.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd components/workerdash
git add workerdash/app.py tests/test_app.py
git commit -m "feat(workerdash): GET /api/ops/<job_id> — drill-down detail route"
```

---

## Task 8: File-serving and raw-JSON routes

**Files:**
- Modify: `components/workerdash/workerdash/app.py`
- Modify: `components/workerdash/tests/test_app.py`

**Interfaces:**
- Consumes: `ops_db.file_slots`, `ops_db.job_analysis_id` (Task 3), `files.resolve`/`files.cleanup`/`files.content_type_for` (Task 5).
- Produces: `GET /api/ops/<job_id>/file/<path:slot>` → streams the file (`200`, correct `Content-Type`, `Content-Disposition: attachment` when the slot's `download` flag is set) or `404 {"ok": false, "error": ...}` for an unknown slot, a slot with no key, a purged slot, or an unresolvable key. `GET /api/ops/<job_id>/json` → the analysis's `final_json` as `200 application/json` with `Content-Disposition: attachment; filename="<job_id>-report.json"`, or `404` if the job has no analysis yet.

**Note on `report_json`:** per the design, the JSON report is a DB column (`analyses.final_json`), not a stored file key — it is deliberately NOT one of `file_slots`' entries and is served exclusively by its own `/json` route (avoids the awkward case of a "file slot" whose key isn't a `files.resolve`-able path).

- [ ] **Step 1: Write the failing tests**

```python
# append to components/workerdash/tests/test_app.py

def test_ops_file_route_streams_existing_file(client, monkeypatch, tmp_path):
    import workerdash.app as app_module
    c, r = client
    audio = tmp_path / "song.wav"
    audio.write_bytes(b"RIFF....")
    monkeypatch.setattr(app_module, "ops_dbmod", type("M", (), {
        "file_slots": staticmethod(lambda conn, jid: {
            "source": {"key": "song.wav", "label": "Source audio",
                       "purged": False, "download": False}
        })
    }))
    monkeypatch.setattr(app_module, "files_mod", type("M", (), {
        "resolve": staticmethod(lambda key: (audio, None)),
        "cleanup": staticmethod(lambda t: None),
        "content_type_for": staticmethod(lambda p: "audio/wav"),
    }))
    res = c.get("/api/ops/j1/file/source")
    assert res.status_code == 200
    assert res.mimetype == "audio/wav"


def test_ops_file_route_unknown_slot_404(client, monkeypatch):
    import workerdash.app as app_module
    c, r = client
    monkeypatch.setattr(app_module, "ops_dbmod",
                         type("M", (), {"file_slots": staticmethod(lambda conn, jid: {})}))
    res = c.get("/api/ops/j1/file/nope")
    assert res.status_code == 404


def test_ops_file_route_purged_slot_404(client, monkeypatch):
    import workerdash.app as app_module
    c, r = client
    monkeypatch.setattr(app_module, "ops_dbmod", type("M", (), {
        "file_slots": staticmethod(lambda conn, jid: {
            "source": {"key": None, "label": "Source audio", "purged": True, "download": False}
        })
    }))
    res = c.get("/api/ops/j1/file/source")
    assert res.status_code == 404
    assert "purged" in res.get_json()["error"]


def test_ops_file_route_unresolvable_key_404(client, monkeypatch):
    import workerdash.app as app_module
    c, r = client
    monkeypatch.setattr(app_module, "ops_dbmod", type("M", (), {
        "file_slots": staticmethod(lambda conn, jid: {
            "source": {"key": "gone.wav", "label": "Source audio",
                       "purged": False, "download": False}
        })
    }))
    monkeypatch.setattr(app_module, "files_mod",
                         type("M", (), {"resolve": staticmethod(lambda key: (None, None))}))
    res = c.get("/api/ops/j1/file/source")
    assert res.status_code == 404


def test_ops_json_route_returns_final_json(client, monkeypatch):
    import workerdash.app as app_module
    c, r = client
    monkeypatch.setattr(app_module, "ops_dbmod", type("M", (), {
        "analysis_final_json": staticmethod(lambda conn, jid: {"phase1": {"lufs": -14}})
    }))
    res = c.get("/api/ops/j1/json")
    assert res.status_code == 200
    assert res.get_json() == {"phase1": {"lufs": -14}}
    assert "attachment" in res.headers["Content-Disposition"]


def test_ops_json_route_no_analysis_404(client, monkeypatch):
    import workerdash.app as app_module
    c, r = client
    monkeypatch.setattr(app_module, "ops_dbmod",
                         type("M", (), {"analysis_final_json": staticmethod(lambda conn, jid: None)}))
    res = c.get("/api/ops/j1/json")
    assert res.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd components/workerdash && python -m pytest tests/test_app.py -k "ops_file or ops_json" -v`
Expected: FAIL — routes and `ops_db.analysis_final_json` don't exist yet

- [ ] **Step 3: Write the implementation**

Add `analysis_final_json` to `ops_db.py` (small, standalone query):

```python
# append to components/workerdash/workerdash/ops_db.py

def analysis_final_json(conn, job_id):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT a.final_json FROM analysis_jobs j "
            "JOIN analyses a ON a.job_id = j.id WHERE j.id::text = %s",
            (job_id,),
        )
        row = cur.fetchone()
    return row[0] if row else None
```

Add to `app.py` (import `files` module too, and `send_file`/`after_this_request` from flask):

```python
from flask import Flask, jsonify, request, send_file, after_this_request
from . import files as files_mod
```

```python
@app.get("/api/ops/<job_id>/file/<path:slot>")
def ops_file(job_id, slot):
    conn = None
    try:
        conn = connect()
        slots = ops_dbmod.file_slots(conn, job_id) or {}
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 404
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass

    entry = slots.get(slot)
    if entry is None:
        return jsonify({"ok": False, "error": "unknown file slot"}), 404
    if entry.get("purged"):
        return jsonify({"ok": False, "error": "source audio purged"}), 404
    if not entry.get("key"):
        return jsonify({"ok": False, "error": "file not available for this run"}), 404

    local_path, fetched = files_mod.resolve(entry["key"])
    if local_path is None:
        return jsonify({"ok": False, "error": "file not found"}), 404

    if fetched is not None:
        @after_this_request
        def _cleanup(response):
            files_mod.cleanup(fetched)
            return response

    return send_file(local_path, mimetype=files_mod.content_type_for(local_path),
                      as_attachment=bool(entry.get("download")),
                      download_name=local_path.name)


@app.get("/api/ops/<job_id>/json")
def ops_json(job_id):
    conn = None
    try:
        conn = connect()
        report = ops_dbmod.analysis_final_json(conn, job_id)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 404
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
    if report is None:
        return jsonify({"ok": False, "error": "no analysis for this job"}), 404
    resp = jsonify(report)
    resp.headers["Content-Disposition"] = f'attachment; filename="{job_id}-report.json"'
    return resp
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd components/workerdash && python -m pytest tests/ -v`
Expected: PASS — full suite green

- [ ] **Step 5: Commit**

```bash
cd components/workerdash
git add workerdash/app.py workerdash/ops_db.py tests/test_app.py
git commit -m "feat(workerdash): file-serving + raw-JSON routes for the Operations drill-down"
```

---

## Task 9: Frontend — Operations tab, list view

**Files:**
- Modify: `components/workerdash/workerdash/app.py` (the `PAGE` constant)

**Interfaces:**
- Consumes: `GET /api/ops` (Task 6).
- Produces: a `Live` / `Operations` tab toggle in the existing page; the Operations tab renders a search box, status dropdown, since/until date inputs, a paginated table, and a "view" link per row that sets `?job=<id>` and triggers Task 10's detail render (implemented in Task 10 — this task only needs the row's view control to update the URL and call a `openJob(id)` function it exports as a global, even before Task 10 defines it, so keep it a plain function reference, not an inline arrow, so redefinition in Task 10 doesn't need touching this task's markup).

- [ ] **Step 1: Manually verify the current page loads**

Run the existing dev server (`cd components/workerdash && python -m workerdash`), open `http://127.0.0.1:5999`, confirm the current Live view still renders. This is the "before" baseline — Task 9/10 changes are inline HTML/JS with no separate test harness beyond the existing `test_page_js.py` syntax guard, so manual verification brackets both tasks.

- [ ] **Step 2: Add the tab markup and CSS**

In `components/workerdash/workerdash/app.py`, modify the `PAGE` string: add tab buttons right after the `<h1>` line, and two container divs:

```html
<div class="tabs">
 <button id="tabLive" class="tabbtn active" onclick="showTab('live')">Live</button>
 <button id="tabOps" class="tabbtn" onclick="showTab('ops')">Operations</button>
</div>
<div id="liveView">
<div id="running"></div>
<div id="queues"></div>
<h2>Recent jobs</h2><div id="recent"></div>
</div>
<div id="opsView" style="display:none">
 <div class="opsFilters">
  <input id="opsSearch" placeholder="search song/version…" oninput="opsDebouncedSearch()">
  <select id="opsStatus" onchange="opsLoad(1)">
   <option value="">any status</option>
   <option value="pending">pending</option>
   <option value="processing">processing</option>
   <option value="complete">complete</option>
   <option value="failed">failed</option>
  </select>
  <input id="opsSince" type="date" onchange="opsLoad(1)">
  <input id="opsUntil" type="date" onchange="opsLoad(1)">
 </div>
 <div id="opsTable"></div>
 <div id="opsPager"></div>
 <div id="opsDetail"></div>
</div>
```

Add matching CSS in the existing `<style>` block:

```css
.tabs{margin-bottom:1rem}.tabbtn{background:#1a1d24;color:#9aa3b2;border:1px solid #2a2e38;
 border-radius:4px 4px 0 0;padding:.4rem 1rem;cursor:pointer;margin-right:.2rem}
.tabbtn.active{background:#232733;color:#e6e6e6;border-bottom-color:#232733}
.opsFilters{display:flex;gap:.5rem;margin-bottom:.7rem}
.opsFilters input,.opsFilters select{background:#1a1d24;color:#e6e6e6;
 border:1px solid #2a2e38;border-radius:4px;padding:.3rem .5rem}
.pagebtn{margin-right:.3rem}
```

- [ ] **Step 3: Add the tab-switching and list-fetching JS**

Inside the existing `<script>` block, add (after the existing `esc()` function definition):

```javascript
let opsPage=1,opsSearchTimer=null;
function showTab(t){
 $('#tabLive').classList.toggle('active',t==='live');
 $('#tabOps').classList.toggle('active',t==='ops');
 $('#liveView').style.display=t==='live'?'':'none';
 $('#opsView').style.display=t==='ops'?'':'none';
 if(t==='ops')opsLoad(1);
}
function opsDebouncedSearch(){
 clearTimeout(opsSearchTimer);
 opsSearchTimer=setTimeout(()=>opsLoad(1),300);
}
async function opsLoad(page){
 opsPage=page;
 const q=new URLSearchParams({page,page_size:25});
 const search=$('#opsSearch').value.trim();
 const status=$('#opsStatus').value;
 const since=$('#opsSince').value;
 const until=$('#opsUntil').value;
 if(search)q.set('search',search);
 if(status)q.set('status',status);
 if(since)q.set('since',since);
 if(until)q.set('until',until);
 let s;try{s=await (await fetch('/api/ops?'+q)).json()}catch(e){
  $('#opsTable').innerHTML='<span class=dead>failed to load</span>';return}
 if(!s.ok){$('#opsTable').innerHTML=`<span class=dead>${esc(s.error||'error')}</span>`;return}
 $('#opsTable').innerHTML=s.rows.length?'<table><tr><th>song</th><th>status</th>'+
  '<th>error</th><th>tokens</th><th>cost</th><th></th></tr>'+
  s.rows.map(j=>{
   const label=j.song?`${esc(j.song)} / ${esc(j.label)} v${j.version_number}`:
    `(anon) ${esc(j.file_path)}`;
   return `<tr><td>${label}</td><td>${esc(j.status)}</td><td>${esc(j.error_code)}</td>`+
    `<td class=mono>${(j.input_tokens||0)+(j.output_tokens||0)}</td>`+
    `<td class=mono>$${(j.cost_usd||0).toFixed(4)}</td>`+
    `<td><button onclick="openJob('${j.id}')">view</button></td></tr>`}).join('')+
  '</table>':'<span class=mono>no runs match</span>';
 const totalPages=Math.max(1,Math.ceil(s.total/s.page_size));
 $('#opsPager').innerHTML=`<span class=mono>page ${s.page}/${totalPages} (${s.total} total)</span> `+
  `<button class=pagebtn ${s.page<=1?'disabled':''} onclick="opsLoad(${s.page-1})">prev</button>`+
  `<button class=pagebtn ${s.page>=totalPages?'disabled':''} onclick="opsLoad(${s.page+1})">next</button>`;
}
```

Note: `s.rows[i].input_tokens`/`output_tokens`/`cost_usd` used above come from `ops_db.list_jobs`'s per-row totals, wired in Task 2 — no further backend change is needed here.

- [ ] **Step 4: Verify the inline JS is still syntactically valid**

Run: `cd components/workerdash && python -m pytest tests/test_page_js.py -v`
Expected: PASS (skips if `node` isn't installed, but run it if available)

- [ ] **Step 5: Manual check**

Start the dashboard, click the "Operations" tab, confirm the table loads (or shows a clear error if Postgres isn't running locally), type in the search box, change the status filter, and click next/prev — confirm the table updates each time.

- [ ] **Step 6: Commit**

```bash
cd components/workerdash
git add workerdash/app.py
git commit -m "feat(workerdash): Operations tab — searchable/paginated run list with token totals"
```

---

## Task 10: Frontend — drill-down detail view

**Files:**
- Modify: `components/workerdash/workerdash/app.py` (the `PAGE` constant)

**Interfaces:**
- Consumes: `GET /api/ops/<job_id>` (Task 7), `GET /api/ops/<job_id>/file/<slot>` and `GET /api/ops/<job_id>/json` (Task 8).
- Produces: `openJob(jobId)` global function (referenced by Task 9's "view" button) that fetches the detail payload, renders it into `#opsDetail`, and sets `?job=<id>` in the URL via `history.pushState` (no reload); on page load, if `?job=<id>` is present, auto-switch to the Operations tab and open that job.

- [ ] **Step 1: Add the detail-rendering JS**

Inside the existing `<script>` block:

```javascript
function fmtCost(n){return '$'+(n||0).toFixed(4)}
function fileLink(jobId,slot,entry){
 if(!entry||!entry.key)return `<span class=mono>${esc(entry?entry.label:slot)}: n/a</span>`;
 if(entry.purged)return `<span class=mono>${esc(entry.label)}: purged</span>`;
 const url=`/api/ops/${jobId}/file/${encodeURIComponent(slot)}`;
 if(slot==='waveform_image'||slot==='spectrogram_image')
  return `<div>${esc(entry.label)}<br><img src="${url}" style="max-width:100%"></div>`;
 if(slot==='source'||slot==='reference'||slot.startsWith('stem:'))
  return `<div>${esc(entry.label)}<br><audio controls src="${url}"></audio></div>`;
 return `<div><a href="${url}" download>${esc(entry.label)}</a></div>`;
}
async function openJob(jobId){
 showTab('ops');
 history.pushState({},'', '?job='+encodeURIComponent(jobId));
 $('#opsDetail').innerHTML='<span class=mono>loading…</span>';
 let s;try{s=await (await fetch('/api/ops/'+jobId)).json()}catch(e){
  $('#opsDetail').innerHTML='<span class=dead>failed to load</span>';return}
 if(!s.ok){$('#opsDetail').innerHTML=`<span class=dead>${esc(s.error||'error')}</span>`;return}
 const t=s.totals||{};
 const files=Object.entries(s.files||{}).map(([slot,e])=>fileLink(jobId,slot,e)).join('');
 const calls=(s.llm_calls||[]).map(c=>`<tr><td>${esc(c.purpose)}</td><td>${esc(c.prompt_slug)}</td>`+
  `<td>${esc(c.model)}</td><td class=mono>${c.input_tokens}</td><td class=mono>${c.output_tokens}</td>`+
  `<td class=mono>${fmtCost(c.cost_usd)}</td><td>${esc(c.outcome)}</td></tr>`).join('');
 const verdicts=(s.verdicts||[]).map(v=>`<tr><td>${esc(v.specialist)}</td><td>${esc(v.severity)}</td>`+
  `<td>${esc(v.headline)}</td><td class=mono>${esc(v.created_at)}</td></tr>`).join('');
 const coach=(s.coach_transcript||[]).map(m=>`<div><b>${esc(m.role)}</b> `+
  `<span class=mono>${fmtCost(m.cost_usd)}</span><br>${esc(m.content)}</div>`).join('');
 $('#opsDetail').innerHTML=`
  <h2>Run ${esc(jobId)} <button onclick="closeJob()">close</button></h2>
  <p>${esc(s.song.name)} / ${esc(s.song.label)} v${s.song.version_number} — ${esc(s.job.status)}</p>
  <h3>Token cost</h3>
  <p class=mono>total: ${(t.input_tokens||0)+(t.output_tokens||0)} tokens, ${fmtCost(t.cost_usd)}</p>
  <table><tr><th>purpose</th><th>prompt</th><th>model</th><th>in</th><th>out</th><th>cost</th><th>outcome</th></tr>${calls}</table>
  <h3>Verdicts</h3><table><tr><th>specialist</th><th>severity</th><th>headline</th><th>at</th></tr>${verdicts}</table>
  <h3>Coach transcript</h3>${coach||'<span class=mono>none</span>'}
  <h3>Files</h3>${files}
  <h3>Report JSON</h3>
  <p><a href="/api/ops/${jobId}/json" download>download raw JSON</a></p>
  <pre class=mono style="max-height:400px;overflow:auto">${esc(JSON.stringify(s.analysis,null,2))}</pre>`;
}
function closeJob(){
 $('#opsDetail').innerHTML='';
 history.pushState({},'', location.pathname);
}
window.addEventListener('DOMContentLoaded',()=>{
 const p=new URLSearchParams(location.search).get('job');
 if(p)openJob(p);
});
```

- [ ] **Step 2: Verify the inline JS is still syntactically valid**

Run: `cd components/workerdash && python -m pytest tests/test_page_js.py -v`
Expected: PASS

- [ ] **Step 3: Manual check**

With Postgres running and at least one `analysis_jobs` row present, start the dashboard, go to Operations, click "view" on a row, confirm: song/status header, token totals line, the per-call table, verdicts table, coach transcript (or "none"), file links (audio players for source/reference/stems, images for waveform/spectrogram, download links for `.als`/peaks/JSON), and the pretty-printed JSON block. Click "close", confirm the URL's `?job=` param clears and the detail panel empties. Reload the page with `?job=<id>` in the URL directly, confirm it auto-opens that run.

- [ ] **Step 4: Commit**

```bash
cd components/workerdash
git add workerdash/app.py
git commit -m "feat(workerdash): Operations drill-down detail view — files, verdicts, coach transcript, JSON"
```

---

## Task 11: Housekeeping — README and CLAUDE.md

**Files:**
- Modify: `components/workerdash/README.md`
- Modify: `CLAUDE.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Update the workerdash README**

Read `components/workerdash/README.md` first. Add a section (matching its existing style) describing the Operations tab: what it shows (every upload/analysis run, searchable/paginated), the drill-down detail (files, JSON report, per-call token/cost breakdown), and the new env vars it reads (`STORAGE_LOCAL_ROOT`, `S3_ENDPOINT`/`S3_BUCKET`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_REGION` — all optional, same defaults as the worker).

- [ ] **Step 2: Update the root CLAUDE.md**

Read the existing workerdash entry in `CLAUDE.md` (added per the 2026-07-26 design's housekeeping step) and extend its one-paragraph description to mention the Operations tab, in the same terse style as the rest of the file's component entries. Do not restructure surrounding sections.

- [ ] **Step 3: Commit**

```bash
git add components/workerdash/README.md CLAUDE.md
git commit -m "docs(workerdash): document the Operations tab and its env vars"
```

---

## Self-Review Notes

- **Spec coverage:** every design-doc section has a task — token-cost join (Task 2/4), list view with search/status/date/pagination (Task 1/6/9), drill-down with files/JSON/verdicts/coach (Task 3/4/7/8/10), file serving local+S3 (Task 5/8), housekeeping (Task 11). The design's "known limitation" (verdicts not FK'd to `llm_calls`) is preserved as-is; the coach side turned out to have exact attribution via `coach_messages.llm_call_id`, which Task 4 uses for a better-than-spec'd result there.
- **Type consistency:** `file_slots()` return shape (`{"key","label","purged","download"}`) is identical across Task 3's producer, Task 4's consumer (embeds it verbatim under `"files"`), Task 8's route consumer, and Task 10's `fileLink()` JS consumer. `ZERO_TOTALS`'s four keys are used identically in Task 2, Task 4, and Task 9's amendment.
- **No placeholders:** all SQL and Python is complete and runnable against the fakes shown; the one deliberate mid-task correction (Task 4's `llm_calls` list) is resolved inline with real code, not left as a TODO.
