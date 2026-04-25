# Architecture — components/worker

Celery async task worker. Picks up upload jobs from Redis, calls `audio_analysis.run_pipeline()` with a dual-mode progress callback, writes progress to PostgreSQL, finalizes results to both PostgreSQL and JSON on disk.

## Celery App (celery_app.py)

```python
app = Celery("worker")
app.config_from_object({
    "broker_url": REDIS_URL,
    "result_backend": REDIS_URL,
    "include": ["app.tasks"],
    "task_track_started": True,          # Required: PENDING otherwise means both "queued" and "never dispatched"
    "result_expires": 86400,             # 24h Redis TTL (not authoritative — DB is)
    "task_serializer": "json",
    "result_serializer": "json",
    "accept_content": ["json"],
    "worker_prefetch_multiplier": 1,     # One task at a time (Demucs is memory-heavy)
    "timezone": "UTC",
    "enable_utc": True,
})
```

---

## Task: run_analysis_pipeline (tasks.py)

```python
@celery_app.task(
    bind=True,
    base=CustomTask,
    soft_time_limit=3600,    # Raises SoftTimeLimitExceeded (graceful)
    time_limit=3900,         # Hard kill if soft limit ignored
    name="app.tasks.run_analysis_pipeline",
)
def run_analysis_pipeline(self, job_id, file_path, reference_path, user_id) -> dict:
```

### Execution Steps

1. `update_job_phase(session, job_id, phase=0, "Starting", pct=0.0, status=PROCESSING)`
2. `progress_cb = make_progress_cb(self, job_id, session)`
3. `pipeline_result = run_pipeline(file_path, reference_path, progress_cb)`
4. Convert TypedDicts to plain dicts for JSON serialization
5. `finalize_job(session, job_id, pipeline_result)` — creates AnalysisResult, marks COMPLETE
6. Write JSON artifact: `{RESULTS_DIR}/{YYYY-MM-DD}_{job_id}.json`
7. Return `result_dict` (stored in Celery backend, but not authoritative)

### Failure Path

- All exceptions caught; `update_job_phase(..., status=FAILED)` called
- Exception re-raised to Celery (task state → FAILED)

### Results Directory

```
RESULTS_DIR = os.environ.get("RESULTS_DIR", "../../output/analysis_results")
# File naming: {date}_{job_id}.json
```

---

## CustomTask Base Class (db.py)

Engine and session lifecycle is **per task execution**, never at module import (fork-safety):

```python
class CustomTask(Task):
    _session = None
    _engine = None

    def before_start(self, task_id, args, kwargs):
        self._engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)
        self._session = sessionmaker(self._engine, expire_on_commit=False)()

    def after_return(self, status, retval, task_id, args, kwargs, einfo):
        if self._session:
            self._session.close()
            self._session = None
        if self._engine:
            self._engine.dispose()
            self._engine = None
```

**Why per-task:** SQLAlchemy engines are not fork-safe. Creating at module import time and forking workers produces corrupted connection state.

### update_job_phase()

```python
def update_job_phase(session, job_id, phase, phase_name, pct, status=None):
```

- Fetches `UploadJob` by UUID
- Updates `current_phase`, `phase_name`, `phase_pct`
- Sets `started_at` on first PROCESSING (if null)
- Sets `completed_at` on COMPLETE or FAILED
- `session.commit()` immediately

### finalize_job()

```python
def finalize_job(session, job_id, pipeline_result):
```

- Creates `AnalysisResult(job_id, phase_results, final_json, share_token=uuid4())`
- Calls `update_job_phase(..., phase=7, "Complete", pct=1.0, status=COMPLETE)`

---

## Dual-Mode Progress (progress.py)

```python
def make_progress_cb(task, job_id, session) -> Callable:
    def progress_cb(phase, phase_name, pct):
        # Mode 1: Celery state (Redis, fast polling)
        task.update_state(state="PROGRESS", meta={"phase": phase, "phase_name": phase_name, "total_phases": 7, "pct": pct})
        # Mode 2: PostgreSQL (persistent, authoritative)
        update_job_phase(session, job_id, phase, phase_name, pct)
    return progress_cb
```

**Why dual:** Celery state provides fast real-time updates (Redis); PostgreSQL provides persistence, history, and survives Redis TTL expiry. **API reads from PostgreSQL only** — never from Celery `AsyncResult`.

---

## Worker Ready Signal (signals.py)

```python
@worker_ready.connect
def preload_models(sender, **kwargs):
    get_model("demucs")  # Loads weights once into memory
```

- Non-fatal: failure logs a warning but worker still starts
- Model singleton survives across all tasks in same worker process

---

## Running the Worker

```bash
# Windows (required: --pool=solo)
cd components/worker
celery -A app.celery_app worker --loglevel=info --concurrency=1 --pool=solo

# Linux
celery -A app.celery_app worker --loglevel=info --concurrency=1 --pool=prefork
```

**Why concurrency=1:** Demucs stem separation requires ~4–8 GB RAM. Multiple concurrent tasks risk OOM.

---

## Dependencies (requirements.txt)

- celery >= 5.3.0
- redis >= 5.0.0
- sqlalchemy >= 2.0.0
- psycopg2-binary (sync driver — asyncpg not needed in worker)
- audio_analysis (installed via `pip install -e components/analysis`)

---

## Key Architectural Rules

| Rule | Reason |
|------|--------|
| Engine created in `before_start`, disposed in `after_return` | Fork-safety: module-level engines corrupt after Celery forks |
| `concurrency=1` always | Demucs memory footprint; never raise without profiling |
| `--pool=solo` on Windows | prefork requires OS fork support |
| PostgreSQL is authoritative, not Redis | Redis `result_expires` silently returns PENDING after 24h |
| `task_track_started=True` | Without it, PENDING means both "queued" and "never dispatched" |
| Partial-failure tolerance | Single bound task + per-phase try/except (Celery chain aborts on first failure) |
| Temp stem files deleted in `finally` | Phase 4 writes multi-GB temp files; never rely on OS cleanup |
