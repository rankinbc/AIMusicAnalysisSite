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
