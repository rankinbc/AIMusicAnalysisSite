# worker

**Purpose**: Dramatiq worker that orchestrates the 7-phase audio analysis pipeline.
Pulls jobs from a Redis-backed `default` queue, calls `audio_analysis.run_pipeline()`,
writes the result to the `analyses` table, and flips `analysis_jobs.status` to
`complete` (or `failed` with `error_message` on exception). Pre-loads the Demucs
model at worker startup, not per-task. Job state is the single source of truth
in Postgres — Redis is only the queue medium.

**Inputs**: file paths in `analysis_jobs.version_id → song_versions.file_path`, resolved against `$STORAGE_LOCAL_ROOT` (default `/data`).

**Outputs**: PostgreSQL `analyses` table (canonical) + optional JSON dump under `$RESULTS_DIR` (default `/data/output/analysis_results`).

**Stack**: Python 3.11+, dramatiq 1.16+ (replaces Celery in v2), Redis (broker), SQLAlchemy 2 (sync/psycopg2), Demucs.

## How to run

```
python -m dramatiq app.dramatiq_app
```

The Procfile is the canonical entrypoint and is wired into the docker-compose
`worker` service.

The legacy Celery files (`app/celery_app.py`, `app/tasks.py`, `app/signals.py`,
`app/tasks_cleanup.py`) are still on disk but are **not loaded** by the dramatiq
entrypoint. A later slice will delete them.

## Environment

| Env var               | Purpose                                                                                    |
|-----------------------|--------------------------------------------------------------------------------------------|
| `DATABASE_URL`        | Postgres URL — accepts `+asyncpg` (auto-converted to `+psycopg2`) or `+psycopg2` directly. |
| `REDIS_URL`           | Dramatiq broker URL (matches BFF `Redis:ConnectionString`).                                |
| `STORAGE_LOCAL_ROOT`  | Where audio files live on disk. Mounted from `data/` in docker-compose.                     |
| `RESULTS_DIR`         | Optional artifact dump directory. Failure is non-fatal.                                     |

## Structure

```
components/worker/
├── README.md          # This file
├── Procfile           # python -m dramatiq app.dramatiq_app
├── requirements.txt   # dramatiq[redis], SQLAlchemy, psycopg2, etc.
├── app/
│   ├── __init__.py
│   ├── dramatiq_app.py    # Broker wiring + actor module import
│   ├── tasks_dramatiq.py  # analyze_audio_job actor (3-phase tx pattern)
│   ├── db_sync.py         # Sync SQLAlchemy session factory (actors are sync)
│   ├── celery_app.py      # LEGACY — not loaded; kept for reference
│   ├── tasks.py           # LEGACY — port-source for tasks_dramatiq.py
│   ├── progress.py        # LEGACY
│   ├── db.py              # LEGACY async session (unused by dramatiq path)
│   └── signals.py         # LEGACY worker_ready hooks
└── tests/
    └── …                   # mocks analysis package and DB
```

---

**To extend this component**: edit `PRPs/source/INITIAL.md` and run `/generate-prp`. Don't modify files here directly for new work — let the PRP drive it.
