# workerdash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standalone local web dashboard (`http://127.0.0.1:5999`) to view/control the SPECTR dramatiq worker: queues, running job, cancel, bring-to-front, retry, worker restart.

**Architecture:** One Flask app in `components/workerdash/` with three focused modules — `wire.py` (dramatiq Redis wire format, single owner), `db.py` (Postgres context reads + job-row mutations), `worker_ctl.py` (Windows process probe/restart) — plus `app.py` (routes + inline single-page HTML). No changes to bff/worker/frontend.

**Tech Stack:** Python 3.11+, Flask, redis-py, psycopg2-binary; pytest + fakeredis for tests.

## Global Constraints

- Bind `127.0.0.1` only, default port `5999` (`WORKERDASH_PORT`).
- Env defaults: `REDIS_URL=redis://localhost:6379/0`, `DATABASE_URL=postgresql://spectr:spectr@localhost:5432/spectr`.
- Dramatiq wire format (must mirror BFF `IJobQueue.EnqueueCoreAsync` exactly):
  queue LIST `dramatiq:<queue>` holds redis_message_ids (RPUSH tail / LPOP head);
  HASH `dramatiq:<queue>.msgs` maps redis_message_id → JSON envelope
  `{queue_name, actor_name, args, kwargs:{}, options:{redis_message_id}, message_id, message_timestamp}`.
  `options.redis_message_id` MUST equal the LIST/HASH key.
- Heartbeat: ZSET `dramatiq:__heartbeats__`, scores are unix-ms; freshest = MAX score.
- Queues: `analysis-paid`, `analysis-free`, `coach`, `maintenance`. There is NO `default` queue.
- All queue mutations use Redis MULTI/EXEC (`pipeline(transaction=True)`).
- Windows-only for `worker_ctl.py` (PowerShell subprocess); everything else cross-platform.
- Project rules: no file over ~500 lines; register the component in CLAUDE.md.

---

### Task 1: Scaffold + wire format encode/parse (pure functions)

**Files:**
- Create: `components/workerdash/pyproject.toml`
- Create: `components/workerdash/workerdash/__init__.py` (empty)
- Create: `components/workerdash/workerdash/wire.py`
- Test: `components/workerdash/tests/test_wire.py`

**Interfaces:**
- Produces: `build_envelope(actor_name: str, args: list, queue_name: str) -> tuple[str, str]` returning `(redis_message_id, json_payload)`; `parse_envelope(raw: str | bytes) -> dict` returning `{actor_name, args, message_id, redis_message_id, queue_name, message_timestamp}` or `{parse_error: str, raw: str}`.

- [ ] **Step 1: Write pyproject + failing tests**

`components/workerdash/pyproject.toml`:

```toml
[project]
name = "workerdash"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = ["flask>=3", "redis>=5", "psycopg2-binary>=2.9"]

[project.optional-dependencies]
dev = ["pytest>=8", "fakeredis>=2"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

`components/workerdash/tests/test_wire.py`:

```python
import json

from workerdash.wire import build_envelope, parse_envelope


def test_build_envelope_matches_dramatiq_contract():
    rid, payload = build_envelope("analyze_audio_job", ["abc-123"], "analysis-paid")
    m = json.loads(payload)
    assert m["queue_name"] == "analysis-paid"
    assert m["actor_name"] == "analyze_audio_job"
    assert m["args"] == ["abc-123"]
    assert m["kwargs"] == {}
    # CRITICAL invariant: worker acks via options.redis_message_id
    assert m["options"]["redis_message_id"] == rid
    assert m["message_id"] != rid  # separate actor-visible id
    assert isinstance(m["message_timestamp"], int)


def test_parse_envelope_round_trip():
    rid, payload = build_envelope("run_triage", ["a1"], "analysis-paid")
    p = parse_envelope(payload)
    assert p["actor_name"] == "run_triage"
    assert p["args"] == ["a1"]
    assert p["redis_message_id"] == rid
    assert p["queue_name"] == "analysis-paid"


def test_parse_envelope_bad_json_returns_error_not_raise():
    p = parse_envelope(b"{not json")
    assert "parse_error" in p
    assert p["raw"].startswith("{not json")
```

- [ ] **Step 2: Run tests, verify failure**

Run: `cd components/workerdash && pip install -e .[dev] && pytest tests/test_wire.py -v`
Expected: FAIL — `ModuleNotFoundError` / `ImportError: build_envelope`

- [ ] **Step 3: Implement `workerdash/wire.py` (encode/parse half)**

```python
"""Dramatiq Redis wire format — the single owner of the queue contract.

Mirrors the BFF's IJobQueue.EnqueueCoreAsync and dramatiq's RedisBroker:
  dramatiq:<queue>       LIST of redis_message_ids (RPUSH enqueue, LPOP fetch)
  dramatiq:<queue>.msgs  HASH redis_message_id -> JSON envelope
options.redis_message_id must equal the LIST/HASH key or the worker
KeyErrors on ack.
"""
import json
import time
import uuid

NAMESPACE = "dramatiq"
QUEUES = ["analysis-paid", "analysis-free", "coach", "maintenance"]


def queue_key(queue: str) -> str:
    return f"{NAMESPACE}:{queue}"


def msgs_key(queue: str) -> str:
    return f"{NAMESPACE}:{queue}.msgs"


def build_envelope(actor_name: str, args: list, queue_name: str) -> tuple[str, str]:
    rid = str(uuid.uuid4())
    envelope = {
        "queue_name": queue_name,
        "actor_name": actor_name,
        "args": args,
        "kwargs": {},
        "options": {"redis_message_id": rid},
        "message_id": str(uuid.uuid4()),
        "message_timestamp": int(time.time() * 1000),
    }
    return rid, json.dumps(envelope)


def parse_envelope(raw) -> dict:
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", errors="replace")
    try:
        m = json.loads(raw)
        return {
            "actor_name": m.get("actor_name"),
            "args": m.get("args", []),
            "message_id": m.get("message_id"),
            "redis_message_id": m.get("options", {}).get("redis_message_id"),
            "queue_name": m.get("queue_name"),
            "message_timestamp": m.get("message_timestamp"),
        }
    except (json.JSONDecodeError, AttributeError) as e:
        return {"parse_error": str(e), "raw": raw[:500]}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pytest tests/test_wire.py -v` — Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
git add components/workerdash
git commit -m "feat(workerdash): scaffold + dramatiq wire encode/parse"
```

---

### Task 2: Queue operations (list / cancel / front / enqueue) on Redis

**Files:**
- Modify: `components/workerdash/workerdash/wire.py` (append functions)
- Test: `components/workerdash/tests/test_queue_ops.py`

**Interfaces:**
- Consumes: Task 1's `build_envelope`, `parse_envelope`, `queue_key`, `msgs_key`.
- Produces: `list_queue(r, queue) -> list[dict]` (ordered head→tail, each = parse_envelope result + `position`); `cancel_message(r, queue, rid) -> bool`; `bring_to_front(r, queue, rid) -> bool`; `enqueue(r, actor_name, args, queue) -> str` (returns rid); `heartbeat_age_seconds(r) -> float | None`.

- [ ] **Step 1: Write failing tests**

`components/workerdash/tests/test_queue_ops.py`:

```python
import fakeredis
import pytest

from workerdash.wire import (
    bring_to_front, cancel_message, enqueue, heartbeat_age_seconds,
    list_queue, msgs_key, queue_key,
)


@pytest.fixture
def r():
    return fakeredis.FakeRedis()


def test_enqueue_then_list_preserves_order(r):
    a = enqueue(r, "analyze_audio_job", ["j1"], "analysis-paid")
    b = enqueue(r, "run_triage", ["a1"], "analysis-paid")
    rows = list_queue(r, "analysis-paid")
    assert [x["redis_message_id"] for x in rows] == [a, b]
    assert rows[0]["position"] == 0 and rows[1]["position"] == 1
    assert r.llen(queue_key("analysis-paid")) == 2
    assert r.hlen(msgs_key("analysis-paid")) == 2


def test_cancel_removes_from_list_and_hash(r):
    a = enqueue(r, "run_triage", ["a1"], "analysis-paid")
    assert cancel_message(r, "analysis-paid", a) is True
    assert r.llen(queue_key("analysis-paid")) == 0
    assert r.hlen(msgs_key("analysis-paid")) == 0


def test_cancel_unknown_id_is_noop_false(r):
    enqueue(r, "run_triage", ["a1"], "analysis-paid")
    assert cancel_message(r, "analysis-paid", "nope") is False
    assert r.llen(queue_key("analysis-paid")) == 1


def test_bring_to_front_moves_to_head(r):
    a = enqueue(r, "x", [], "analysis-paid")
    b = enqueue(r, "y", [], "analysis-paid")
    c = enqueue(r, "z", [], "analysis-paid")
    assert bring_to_front(r, "analysis-paid", c) is True
    rows = list_queue(r, "analysis-paid")
    assert [x["redis_message_id"] for x in rows] == [c, a, b]


def test_list_queue_orphan_id_renders_error_row(r):
    r.rpush(queue_key("analysis-paid"), "ghost")
    rows = list_queue(r, "analysis-paid")
    assert rows[0]["redis_message_id"] == "ghost"
    assert "parse_error" in rows[0]


def test_heartbeat_age(r):
    assert heartbeat_age_seconds(r) is None
    import time
    r.zadd("dramatiq:__heartbeats__", {"w1": int(time.time() * 1000) - 5000})
    age = heartbeat_age_seconds(r)
    assert 4 <= age <= 7
```

- [ ] **Step 2: Run, verify failure**

Run: `pytest tests/test_queue_ops.py -v` — Expected: FAIL `ImportError: list_queue`

- [ ] **Step 3: Append implementations to `wire.py`**

```python
import time as _time

HEARTBEATS_KEY = f"{NAMESPACE}:__heartbeats__"


def enqueue(r, actor_name: str, args: list, queue: str) -> str:
    rid, payload = build_envelope(actor_name, args, queue)
    pipe = r.pipeline(transaction=True)
    pipe.hset(msgs_key(queue), rid, payload)
    pipe.rpush(queue_key(queue), rid)
    pipe.execute()
    return rid


def list_queue(r, queue: str) -> list[dict]:
    ids = [i.decode() if isinstance(i, bytes) else i
           for i in r.lrange(queue_key(queue), 0, -1)]
    if not ids:
        return []
    raws = r.hmget(msgs_key(queue), ids)
    rows = []
    for pos, (rid, raw) in enumerate(zip(ids, raws)):
        row = parse_envelope(raw) if raw is not None else {"parse_error": "payload missing from .msgs hash", "raw": ""}
        row["redis_message_id"] = row.get("redis_message_id") or rid
        row["position"] = pos
        rows.append(row)
    return rows


def cancel_message(r, queue: str, rid: str) -> bool:
    pipe = r.pipeline(transaction=True)
    pipe.lrem(queue_key(queue), 0, rid)
    pipe.hdel(msgs_key(queue), rid)
    removed, _ = pipe.execute()
    return removed > 0


def bring_to_front(r, queue: str, rid: str) -> bool:
    # Worker consumes from the head (LPOP); LREM+LPUSH promotes the id.
    pipe = r.pipeline(transaction=True)
    pipe.lrem(queue_key(queue), 0, rid)
    pipe.lpush(queue_key(queue), rid)
    removed, _ = pipe.execute()
    if removed == 0:
        # id wasn't queued — undo the phantom LPUSH we just did
        r.lrem(queue_key(queue), 0, rid)
        return False
    return True


def heartbeat_age_seconds(r):
    top = r.zrange(HEARTBEATS_KEY, -1, -1, withscores=True)
    if not top:
        return None
    now_ms = _time.time() * 1000
    return max(0.0, (now_ms - top[0][1]) / 1000)
```

- [ ] **Step 4: Run, verify pass**

Run: `pytest tests/ -v` — Expected: all PASS (Task 1 + 2 suites)

- [ ] **Step 5: Commit**

```bash
git add components/workerdash
git commit -m "feat(workerdash): queue list/cancel/front/enqueue + heartbeat"
```

---

### Task 3: Postgres context layer (`db.py`)

**Files:**
- Create: `components/workerdash/workerdash/db.py`
- Test: `components/workerdash/tests/test_db.py`

**Interfaces:**
- Consumes: nothing from earlier tasks (parallel-safe).
- Produces: `connect() -> psycopg2 connection` (from `DATABASE_URL`); `job_context(conn, job_ids: list[str]) -> dict[str, dict]` mapping job id → `{song, label, status, current_phase}`; `processing_jobs(conn) -> list[dict]`; `recent_jobs(conn, limit=20) -> list[dict]`; `mark_cancelled(conn, job_id) -> bool`; `mark_retry_pending(conn, job_id) -> bool` (only flips rows currently `failed`; returns False otherwise).

- [ ] **Step 1: Write failing tests (fake connection — no live Postgres needed)**

`components/workerdash/tests/test_db.py`:

```python
from workerdash import db


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows
        self.executed = []
        self.rowcount = 0

    def execute(self, sql, params=None):
        self.executed.append((" ".join(sql.split()), params))
        self.rowcount = 1 if "UPDATE" in sql else len(self.rows)

    def fetchall(self):
        return self.rows

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeConn:
    def __init__(self, rows=()):  # rows returned by every query
        self.cur = FakeCursor(list(rows))
        self.committed = False

    def cursor(self):
        return self.cur

    def commit(self):
        self.committed = True


def test_job_context_maps_rows():
    conn = FakeConn(rows=[("j1", "22", "5_bb", "complete", "")])
    ctx = db.job_context(conn, ["j1"])
    assert ctx["j1"] == {"song": "22", "label": "5_bb",
                        "status": "complete", "current_phase": ""}


def test_job_context_empty_ids_no_query():
    conn = FakeConn()
    assert db.job_context(conn, []) == {}
    assert conn.cur.executed == []


def test_mark_cancelled_updates_and_commits():
    conn = FakeConn()
    assert db.mark_cancelled(conn, "j1") is True
    sql, params = conn.cur.executed[0]
    assert "UPDATE analysis_jobs" in sql
    assert "cancelled_by_operator" in sql
    assert params == ("j1",)
    assert conn.committed


def test_mark_retry_pending_guards_failed_only():
    conn = FakeConn()
    db.mark_retry_pending(conn, "j1")
    sql, _ = conn.cur.executed[0]
    assert "status = 'pending'" in sql
    assert "status = 'failed'" in sql  # WHERE guard
```

- [ ] **Step 2: Run, verify failure**

Run: `pytest tests/test_db.py -v` — Expected: FAIL `ImportError`/`AttributeError`

- [ ] **Step 3: Implement `workerdash/db.py`**

```python
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
```

- [ ] **Step 4: Run, verify pass**

Run: `pytest tests/test_db.py -v` — Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add components/workerdash
git commit -m "feat(workerdash): postgres context + job mutations"
```

---

### Task 4: Worker process probe + restart (`worker_ctl.py`)

**Files:**
- Create: `components/workerdash/workerdash/worker_ctl.py`
- Test: `components/workerdash/tests/test_worker_ctl.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `probe() -> dict` = `{master: bool, fork: bool}`; `derive_status(master, fork, heartbeat_age) -> str` ∈ `healthy|half-dead|dead` (pure); `restart(worker_dir: str) -> dict` = `{ok, error?}`.

- [ ] **Step 1: Write failing tests (pure part only)**

`components/workerdash/tests/test_worker_ctl.py`:

```python
from workerdash.worker_ctl import derive_status


def test_healthy():
    assert derive_status(True, True, 3.0) == "healthy"


def test_half_dead_fork_missing_but_heartbeat_fresh():
    assert derive_status(True, False, 3.0) == "half-dead"
    assert derive_status(False, True, 3.0) == "half-dead"


def test_dead_no_processes():
    assert derive_status(False, False, 3.0) == "dead"
    assert derive_status(False, False, None) == "dead"


def test_dead_stale_heartbeat_even_with_processes():
    assert derive_status(True, True, 120.0) == "dead"
```

- [ ] **Step 2: Run, verify failure**

Run: `pytest tests/test_worker_ctl.py -v` — Expected: FAIL ImportError

- [ ] **Step 3: Implement `workerdash/worker_ctl.py`**

```python
"""Windows worker process probe + restart. Mirrors docs/STARTUP.md exactly:
NEVER kill only the dramatiq master (orphans the fork) — tree-kill, then
sweep orphaned forks, then relaunch the canonical Procfile command."""
import os
import subprocess

HEARTBEAT_STALE_SECONDS = 60

_PROBE_PS = (
    "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | "
    "ForEach-Object { $_.CommandLine }"
)

_KILL_PS = """
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -match 'dramatiq' } |
  ForEach-Object { taskkill /F /T /PID $_.ProcessId }
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -match 'multiprocessing' -and
                 -not (Get-Process -Id $_.ParentProcessId -ErrorAction SilentlyContinue) } |
  Stop-Process -Force
"""

_LAUNCH_PS = (
    "Start-Process powershell -WindowStyle Minimized -ArgumentList "
    "'-NoExit','-Command',"
    "\"Set-Location '{worker_dir}'; python -m dramatiq app.dramatiq_app "
    "--processes 1 --threads 1 "
    "--queues coach analysis-paid analysis-free maintenance\""
)


def _ps(script: str) -> str:
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command", script],
        capture_output=True, text=True, timeout=30)
    return out.stdout


def probe() -> dict:
    try:
        lines = _ps(_PROBE_PS).splitlines()
    except Exception:
        return {"master": False, "fork": False}
    return {
        "master": any("dramatiq" in (l or "") for l in lines),
        "fork": any("multiprocessing" in (l or "") for l in lines),
    }


def derive_status(master: bool, fork: bool, heartbeat_age) -> str:
    if not master and not fork:
        return "dead"
    if heartbeat_age is None or heartbeat_age > HEARTBEAT_STALE_SECONDS:
        return "dead"
    if master and fork:
        return "healthy"
    return "half-dead"


def allin1_container() -> str | None:
    """Best-effort: name of a running structure-detection container, if any.
    Uses the full docker.exe path — bare `docker` is shadowed on this machine
    (see STARTUP.md problem #1)."""
    exe = r"C:\Program Files\Docker\Docker\resources\bin\docker.exe"
    try:
        out = subprocess.run([exe, "ps", "--format", "{{.Names}}"],
                             capture_output=True, text=True, timeout=10)
        names = [n for n in out.stdout.splitlines()
                 if n and not n.startswith("docker-")]  # infra is docker-postgres-1 etc.
        return names[0] if names else None
    except Exception:
        return None


def restart(worker_dir: str) -> dict:
    if not os.path.isdir(worker_dir):
        return {"ok": False, "error": f"worker dir not found: {worker_dir}"}
    try:
        _ps(_KILL_PS)
        _ps(_LAUNCH_PS.format(worker_dir=worker_dir))
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}
```

- [ ] **Step 4: Run, verify pass**

Run: `pytest tests/test_worker_ctl.py -v` — Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add components/workerdash
git commit -m "feat(workerdash): worker probe/status/restart"
```

---

### Task 5: Flask app — /api/state + action routes

**Files:**
- Create: `components/workerdash/workerdash/app.py`
- Create: `components/workerdash/workerdash/__main__.py`
- Test: `components/workerdash/tests/test_app.py`

**Interfaces:**
- Consumes: `wire.list_queue/cancel_message/bring_to_front/enqueue/heartbeat_age_seconds/QUEUES`, `db.*` (Task 3 signatures), `worker_ctl.probe/derive_status/restart`.
- Produces: `create_app(redis_client=None, db_connect=None, ctl=None) -> Flask` — injectable for tests; routes per spec.

- [ ] **Step 1: Write failing tests**

`components/workerdash/tests/test_app.py`:

```python
import fakeredis
import pytest

from workerdash import wire
from workerdash.app import create_app


class StubConn:  # db failures shouldn't 500 the state endpoint
    def cursor(self):
        raise RuntimeError("db down")


class Ctl:
    def probe(self):
        return {"master": True, "fork": True}

    def derive_status(self, m, f, hb):
        from workerdash.worker_ctl import derive_status
        return derive_status(m, f, hb)

    def restart(self, worker_dir):
        return {"ok": True}


@pytest.fixture
def client():
    r = fakeredis.FakeRedis()
    app = create_app(redis_client=r, db_connect=lambda: StubConn(), ctl=Ctl())
    app.config["TESTING"] = True
    return app.test_client(), r


def test_state_empty_redis_and_dead_db_still_renders(client):
    c, r = client
    res = c.get("/api/state")
    assert res.status_code == 200
    body = res.get_json()
    assert body["worker"]["status"] in ("healthy", "half-dead", "dead")
    assert set(q["name"] for q in body["queues"]) == set(wire.QUEUES)
    assert "error" in body["db"]  # db section degraded, not fatal


def test_cancel_route_removes_message(client):
    c, r = client
    rid = wire.enqueue(r, "run_triage", ["a1"], "analysis-paid")
    res = c.post(f"/api/queue/analysis-paid/{rid}/cancel")
    assert res.get_json()["ok"] is True
    assert wire.list_queue(r, "analysis-paid") == []


def test_cancel_unknown_id_ok_false(client):
    c, r = client
    res = c.post("/api/queue/analysis-paid/nope/cancel")
    assert res.get_json()["ok"] is False


def test_front_route(client):
    c, r = client
    a = wire.enqueue(r, "x", [], "analysis-paid")
    b = wire.enqueue(r, "y", [], "analysis-paid")
    res = c.post(f"/api/queue/analysis-paid/{b}/front")
    assert res.get_json()["ok"] is True
    assert wire.list_queue(r, "analysis-paid")[0]["redis_message_id"] == b


def test_bad_queue_name_404(client):
    c, r = client
    assert c.post("/api/queue/not-a-queue/x/cancel").status_code == 404


def test_index_serves_html(client):
    c, r = client
    res = c.get("/")
    assert res.status_code == 200
    assert b"workerdash" in res.data
```

- [ ] **Step 2: Run, verify failure**

Run: `pytest tests/test_app.py -v` — Expected: FAIL ImportError create_app

- [ ] **Step 3: Implement `workerdash/app.py`**

```python
"""Flask app. All external clients injectable; defaults built from env."""
import os

from flask import Flask, jsonify, request

from . import db as dbmod
from . import wire
from . import worker_ctl as ctlmod

WORKER_DIR_DEFAULT = os.path.normpath(os.path.join(
    os.path.dirname(__file__), "..", "..", "worker"))


def _default_redis():
    import redis
    return redis.Redis.from_url(
        os.environ.get("REDIS_URL", "redis://localhost:6379/0"))


def create_app(redis_client=None, db_connect=None, ctl=None) -> Flask:
    app = Flask(__name__)
    r = redis_client or _default_redis()
    connect = db_connect or dbmod.connect
    ctl = ctl or ctlmod

    def db_section():
        """Postgres context; degrades to {'error': ...} instead of failing."""
        try:
            conn = connect()
            return {
                "processing": dbmod.processing_jobs(conn),
                "recent": dbmod.recent_jobs(conn),
            }, conn
        except Exception as e:
            return {"error": str(e)}, None

    @app.get("/api/state")
    def state():
        try:
            hb = wire.heartbeat_age_seconds(r)
            p = ctl.probe()
            worker = {"heartbeat_age": hb, **p,
                      "status": ctl.derive_status(p["master"], p["fork"], hb)}
            try:
                worker["allin1_container"] = ctl.allin1_container()
            except AttributeError:
                worker["allin1_container"] = None  # test stubs may omit it
            queues = []
            for q in wire.QUEUES:
                try:
                    msgs = wire.list_queue(r, q)
                except Exception as e:
                    msgs, q_err = [], str(e)
                else:
                    q_err = None
                queues.append({"name": q, "depth": len(msgs),
                               "messages": msgs, "error": q_err})
        except Exception as e:
            return jsonify({"worker": {"status": "unknown", "error": str(e)},
                            "queues": [], "db": {"error": "skipped"}})
        dbs, conn = db_section()
        # resolve song/version context for queued analyze_audio_job args
        if conn is not None:
            job_ids = [m["args"][0] for q in queues for m in q["messages"]
                       if m.get("actor_name") == "analyze_audio_job" and m.get("args")]
            try:
                ctx = dbmod.job_context(conn, job_ids)
                for q in queues:
                    for m in q["messages"]:
                        if m.get("actor_name") == "analyze_audio_job" and m.get("args"):
                            m["context"] = ctx.get(m["args"][0])
            except Exception:
                pass
            finally:
                conn.close()
        return jsonify({"worker": worker, "queues": queues, "db": dbs})

    def _check_queue(queue):
        return queue in wire.QUEUES

    @app.post("/api/queue/<queue>/<rid>/cancel")
    def cancel(queue, rid):
        if not _check_queue(queue):
            return jsonify({"ok": False, "error": "unknown queue"}), 404
        try:
            # read actor before deleting so we can mark the DB row
            row = next((m for m in wire.list_queue(r, queue)
                        if m["redis_message_id"] == rid), None)
            ok = wire.cancel_message(r, queue, rid)
            if ok and row and row.get("actor_name") == "analyze_audio_job" and row.get("args"):
                try:
                    conn = connect()
                    dbmod.mark_cancelled(conn, row["args"][0])
                    conn.close()
                except Exception:
                    pass  # queue removal succeeded; DB mark is best-effort
            return jsonify({"ok": ok})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)})

    @app.post("/api/queue/<queue>/<rid>/front")
    def front(queue, rid):
        if not _check_queue(queue):
            return jsonify({"ok": False, "error": "unknown queue"}), 404
        try:
            return jsonify({"ok": wire.bring_to_front(r, queue, rid)})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)})

    @app.post("/api/jobs/<job_id>/retry")
    def retry(job_id):
        try:
            conn = connect()
            if not dbmod.mark_retry_pending(conn, job_id):
                conn.close()
                return jsonify({"ok": False, "error": "job is not in failed state"})
            conn.close()
            rid = wire.enqueue(r, "analyze_audio_job", [job_id], "analysis-paid")
            return jsonify({"ok": True, "redis_message_id": rid})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)})

    @app.post("/api/worker/restart")
    def restart():
        return jsonify(ctl.restart(
            os.environ.get("WORKER_DIR", WORKER_DIR_DEFAULT)))

    @app.get("/")
    def index():
        return PAGE, 200, {"Content-Type": "text/html; charset=utf-8"}

    return app


PAGE = """<!doctype html>
<title>workerdash</title>
<meta charset="utf-8">
<style>
 body{font:14px/1.4 system-ui;margin:1.5rem;background:#0f1115;color:#e6e6e6}
 h1{font-size:1.2rem} h2{font-size:1rem;margin:1.2rem 0 .4rem}
 table{border-collapse:collapse;width:100%} td,th{padding:.3rem .6rem;
 border-bottom:1px solid #2a2e38;text-align:left;font-size:.85rem}
 .healthy{color:#5dd08c}.half-dead{color:#e8b34c}.dead,.unknown{color:#ef6a6a}
 button{background:#232733;color:#e6e6e6;border:1px solid #3a4050;
 border-radius:4px;padding:.15rem .55rem;cursor:pointer;margin-right:.3rem}
 button:hover{background:#2e3342} #toast{position:fixed;bottom:1rem;right:1rem;
 background:#232733;padding:.5rem .9rem;border-radius:6px;display:none}
 .mono{font-family:ui-monospace,monospace;font-size:.78rem;color:#9aa3b2}
 #restart{border-color:#a04747}
</style>
<h1>workerdash — <span id="wstatus" class="unknown">…</span>
 <span id="whb" class="mono"></span>
 <button id="restart" onclick="restartWorker()">restart worker</button></h1>
<div id="running"></div>
<div id="queues"></div>
<h2>Recent jobs</h2><div id="recent"></div>
<div id="toast"></div>
<script>
const $=q=>document.querySelector(q);
function toast(m){const t=$('#toast');t.textContent=m;t.style.display='block';
 setTimeout(()=>t.style.display='none',3000)}
async function act(url){const r=await fetch(url,{method:'POST'});
 const j=await r.json();toast(j.ok?'ok':('failed: '+(j.error||'')));load()}
function restartWorker(){if(confirm('Tree-kill and relaunch the worker?'))
 act('/api/worker/restart')}
function esc(s){return String(s??'').replace(/[&<>"]/g,
 c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
async function load(){
 let s;try{s=await (await fetch('/api/state')).json()}catch(e){
  $('#wstatus').textContent='dashboard error';return}
 const w=s.worker;$('#wstatus').textContent=w.status;
 $('#wstatus').className=w.status;
 $('#whb').textContent=w.heartbeat_age==null?'(no heartbeat ever)':
  `heartbeat ${Math.round(w.heartbeat_age)}s ago · master:${w.master} fork:${w.fork}`;
 const run=(s.db&&s.db.processing)||[];
 $('#running').innerHTML='<h2>Running now</h2>'+(run.length?'<table>'+
  run.map(j=>`<tr><td>${esc(j.song)} / ${esc(j.label)}</td>
   <td>${esc(j.current_phase)}</td><td>${Math.round((j.phase_pct||0)*100)}%</td>
   <td class=mono>${esc(j.id)}</td></tr>`).join('')+'</table>'
  :'<span class=mono>idle</span>');
 $('#queues').innerHTML=s.queues.map(q=>`<h2>${q.name} (${q.depth})
  ${q.error?`<span class=dead>${esc(q.error)}</span>`:''}</h2>`+
  (q.messages.length?'<table><tr><th>#</th><th>actor</th><th>args / context</th>
   <th></th></tr>'+q.messages.map(m=>{
   const ctx=m.context?` — ${esc(m.context.song)} / ${esc(m.context.label)}`:'';
   const body=m.parse_error?`<span class=dead>${esc(m.parse_error)}</span>
    <span class=mono>${esc(m.raw)}</span>`:
    `${esc(m.actor_name)}</td><td class=mono>${esc(JSON.stringify(m.args))}${ctx}`;
   return `<tr><td>${m.position}</td><td>${body}</td><td>
    <button onclick="act('/api/queue/${q.name}/${m.redis_message_id}/front')">front</button>
    <button onclick="act('/api/queue/${q.name}/${m.redis_message_id}/cancel')">cancel</button>
    </td></tr>`}).join('')+'</table>':'<span class=mono>empty</span>'))
  .join('');
 const rec=(s.db&&s.db.recent)||[];
 $('#recent').innerHTML=s.db&&s.db.error?
  `<span class=dead>db: ${esc(s.db.error)}</span>`:
  '<table><tr><th>song</th><th>status</th><th>error</th><th>dispatched</th>
  <th></th></tr>'+rec.map(j=>`<tr><td>${esc(j.song)} / ${esc(j.label)}</td>
  <td>${esc(j.status)}</td><td>${esc(j.error_code)}</td>
  <td class=mono>${esc(j.dispatched_at)}</td>
  <td>${j.status==='failed'?`<button onclick="act('/api/jobs/${j.id}/retry')">retry</button>`:''}</td>
  </tr>`).join('')+'</table>';
}
load();setInterval(load,2000);
</script>"""
```

`workerdash/__main__.py`:

```python
import os

from .app import create_app

if __name__ == "__main__":
    create_app().run(host="127.0.0.1",
                     port=int(os.environ.get("WORKERDASH_PORT", "5999")))
```

- [ ] **Step 4: Run, verify pass**

Run: `pytest tests/ -v` — Expected: all suites PASS

- [ ] **Step 5: Commit**

```bash
git add components/workerdash
git commit -m "feat(workerdash): flask app, state + action routes, dashboard page"
```

---

### Task 6: Live smoke test + README + CLAUDE.md registration

**Files:**
- Create: `components/workerdash/README.md`
- Modify: `CLAUDE.md` (project-structure tree + Components section)

**Interfaces:**
- Consumes: the running stack (Redis/Postgres up) + Task 5's `python -m workerdash`.

- [ ] **Step 1: Live smoke test against the real stack**

```bash
cd components/workerdash && python -m workerdash &
sleep 2
curl -s http://127.0.0.1:5999/api/state | python -m json.tool | head -30
```

Expected: JSON with `worker.status` (healthy if the worker is up), 4 queues, `db.recent` showing real jobs. Open `http://127.0.0.1:5999` in a browser and eyeball: status header, queues render, recent jobs table. Then Ctrl-C the server.

- [ ] **Step 2: Write `components/workerdash/README.md`**

```markdown
# workerdash

Standalone local dashboard for the SPECTR dramatiq worker.

    cd components/workerdash
    pip install -e .[dev]
    python -m workerdash          # http://127.0.0.1:5999

Shows worker status (healthy / half-dead / dead via heartbeat ZSET + process
probe), running jobs with phase, all four queues decoded with song/version
context, last-20 job history. Actions: cancel queued message (also marks the
analysis_jobs row failed/cancelled_by_operator), bring-to-front, retry failed
job, restart worker (STARTUP.md tree-kill + relaunch; Windows only).

Env: REDIS_URL, DATABASE_URL, WORKERDASH_PORT (5999), WORKER_DIR.
Localhost-only, no auth — dev tool. Tests: `pytest`.
```

- [ ] **Step 3: Register in CLAUDE.md**

In the project-structure tree, under `components/`, after the `frontend-spectr/` line add:

```
│   └── workerdash/           (Standalone local dramatiq worker dashboard — see its README)
```

(adjust tree characters so the previous last entry uses `├──`). In the Components section add:

```markdown
### workerdash (dev ops tool)

**Purpose**: Standalone local web dashboard for the dramatiq worker: queue
contents with song/version context, worker health (healthy/half-dead/dead),
cancel / bring-to-front / retry job actions, worker restart per STARTUP.md.
**Inputs**: Redis (dramatiq wire format), PostgreSQL (read + job-row updates)
**Outputs**: http://127.0.0.1:5999 (localhost only, no auth)
**How to run**: `cd components/workerdash && python -m workerdash`
```

- [ ] **Step 4: Full validation gates**

Run: `cd components/workerdash && pytest -q` — Expected: all PASS
Run: `ruff check components/workerdash/` — Expected: clean (fix anything it flags)

- [ ] **Step 5: Commit**

```bash
git add components/workerdash/README.md CLAUDE.md
git commit -m "feat(workerdash): README + CLAUDE.md registration"
```
