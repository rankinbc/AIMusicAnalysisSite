# worker

**Purpose**: Celery worker that orchestrates the 7-phase audio analysis pipeline. Picks up upload jobs from a Redis broker, calls analysis.run_pipeline() with a progress callback that writes per-phase state to PostgreSQL and updates Celery task state via self.update_state(). Implements partial-failure tolerance: each phase is wrapped in try/except — a failed phase records the error but the job continues with remaining phases. Writes final JSON result to output/analysis_results/ and PostgreSQL. Cleans up temp stem files after Phase 4. Pre-loads the Demucs model at worker startup (not per-task).

**Inputs**: data/uploads/ (audio files — path read from job payload)

**Outputs**: output/analysis_results/ (final summary JSON), PostgreSQL analysis_results table

**Pattern**: `automation.md`

**Stack**: Python 3.11+, Celery 5, Redis (broker + result backend), SQLAlchemy 2 (sync/psycopg2), Demucs

## How to run

Linux / Mac:
```
celery -A app.celery_app worker --loglevel=info --concurrency=1 --pool=prefork
```

Windows (solo pool required — prefork does not work on Windows):
```
celery -A app.celery_app worker --loglevel=info --concurrency=1 --pool=solo
```

From the project root, run against the correct working directory:
```
cd components/worker && celery -A app.celery_app worker --loglevel=info --concurrency=1 --pool=solo
```

Or use the Procfile (Honcho / Heroku-style):
```
pip install honcho
cd components/worker && honcho start
```

## Structure

```
components/worker/
├── README.md          # This file
├── Procfile           # Worker start command (honcho / heroku)
├── requirements.txt   # Celery, Redis, SQLAlchemy, Demucs, etc.
├── .env.example       # Secret template (REDIS_URL, DATABASE_URL)
├── app/
│   ├── __init__.py    # Package marker
│   ├── celery_app.py  # Celery instance + config (task_track_started, result_expires, etc.)
│   ├── tasks.py       # run_analysis_pipeline — single bound task, 7-phase loop, per-phase try/except
│   ├── progress.py    # Progress callback factory: writes phase state to DB + calls update_state
│   ├── db.py          # Sync SQLAlchemy engine (psycopg2) safe for Celery fork model
│   └── signals.py     # worker_ready signal — pre-loads Demucs model once at startup
└── tests/
    ├── __init__.py
    └── test_tasks.py  # Stub — mocks analysis package and DB
```

---

**To extend this component**: edit `PRPs/source/INITIAL.md` and run `/generate-prp`. Don't modify files here directly for new work — let the PRP drive it.
