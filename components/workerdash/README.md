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
Retry always dispatches a full analyze_audio_job — for jobs that were
per-phase re-run vehicles this runs a complete new analysis, not just the
phase.

Env: REDIS_URL, DATABASE_URL, WORKERDASH_PORT (5999), WORKER_DIR.
Localhost-only, no auth — dev tool. Tests: `pytest`.

## Operations tab

Searchable, paginated list of every upload/analysis run (backed by
`analysis_jobs` and `analyses` tables). Drill-down detail per run shows:
original audio file + .als project (if any), JSON report, verdicts payload,
coach transcript, and per-call LLM token counts + cost breakdown (summed from
`llm_calls`, segmented by direct-call and coach-message paths).

File serving supports both local disk (default, via `STORAGE_LOCAL_ROOT`,
defaults to repo `data/`) and S3 (optional: `S3_ENDPOINT`, `S3_BUCKET`,
`S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION` — all optional, same defaults
and conventions as the worker component). Purged audio is marked unavailable
in the drill-down.
