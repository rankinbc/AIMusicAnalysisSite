# workerdash — standalone worker/queue dashboard (design)

Date: 2026-07-26
Status: approved (brainstorm w/ user)

## Purpose

A lightweight, standalone local ops tool for the SPECTR dramatiq worker:
see what's running and queued, cancel queued jobs, bring jobs to the front,
retry failed jobs, and restart a dead/half-dead worker. Deliberately separate
from the SPECTR app — no BFF/frontend/worker code changes.

## Placement & runtime

- New component `components/workerdash/` (Python, ~3 files, no build step).
- Run: `cd components/workerdash && python -m workerdash` → serves
  `http://127.0.0.1:5999` (localhost bind only, no auth — dev tool).
- Dependencies: `flask`, `redis`, `psycopg2` (already in the worker env);
  installable standalone via its own `pyproject.toml` or requirements.txt.
- Config via env with dev defaults: `REDIS_URL=redis://localhost:6379`,
  `DATABASE_URL=postgresql://spectr:spectr@localhost:5432/spectr`,
  `WORKERDASH_PORT=5999`.

## Architecture

Single Flask app, one HTML page (inline CSS/JS, no framework), JSON API:

- `GET /` — the dashboard page; polls `/api/state` every 2 s.
- `GET /api/state` — full snapshot (worker, queues, running, history).
- `POST /api/queue/<queue>/<message_id>/cancel`
- `POST /api/queue/<queue>/<message_id>/front`
- `POST /api/jobs/<job_id>/retry`
- `POST /api/worker/restart`

A `wire.py` module owns the dramatiq wire format (single import boundary):
queue LIST `dramatiq:<queue>` (message ids, RPUSH tail / LPOP head), payload
HASH `dramatiq:<queue>.msgs` (id → JSON, with
`message.options.redis_message_id` == the LIST/HASH key). This mirrors the
BFF's `IJobQueue` contract documented in CLAUDE.md.

## /api/state contents

1. **Worker**: dramatiq heartbeat age (Redis `dramatiq:__heartbeats__`),
   plus native process check (master `python -m dramatiq` cmdline + a
   `multiprocessing` fork child). Derived status:
   - `healthy` — processes up + fresh heartbeat
   - `half-dead` — heartbeat fresh but master or fork missing
   - `dead` — no processes / stale heartbeat
2. **Running now**: `analysis_jobs` rows with `status='processing'`
   (id, `current_phase`, song name + version label via joins), plus any
   running allin1 docker container name (best-effort `docker ps`).
3. **Queues**: for each of `analysis-paid`, `analysis-free`, `coach`,
   `maintenance`: depth + ordered decoded messages — position, message id,
   actor name, args, and (when an arg resolves to an
   analysis_job/analysis/version id) the song name + version label.
4. **History**: last 20 `analysis_jobs` (status, error_code, created/updated).

Redis or Postgres unreachable → that section carries an `error` string; the
page renders the error instead of crashing.

## Actions

- **Cancel** (queued messages only): MULTI/EXEC `LREM` id from LIST +
  `HDEL` from `.msgs`. If the message is `analyze_audio_job`, also update the
  `analysis_jobs` row → `status='failed'`, `error_code='cancelled_by_operator'`
  so the app UI stops waiting. In-flight (already LPOP'd) messages cannot be
  cancelled; the UI labels the currently-consumed message accordingly.
- **Bring to front**: MULTI/EXEC `LREM` + `LPUSH` (worker consumes from the
  head/left). Payload HASH untouched.
- **Retry failed**: for a `failed` `analysis_jobs` row: build a fresh
  `analyze_audio_job` wire message (new uuid message id, correct
  `redis_message_id`), enqueue to `analysis-paid` (dev = premium tier per the
  credits kill switch), flip the row to `pending` and clear `error_code`.
- **Restart worker** (confirmation required in UI): per STARTUP.md — tree-kill
  dramatiq masters (`taskkill /F /T`), sweep orphaned forks with dead parents,
  then relaunch the canonical Procfile command in a new minimized PowerShell
  window from `components/worker`. Windows-only by design.

All actions are idempotent (LREM/HDEL of a missing id is a no-op) and the UI
re-fetches state after each action.

## Error handling

- Every action returns `{ok: bool, error?: str}`; failures surface as a toast
  line on the page, never a blank 500.
- Wire-format parse failures on a message render the raw JSON snippet rather
  than hiding the row.
- The restart endpoint refuses to run if it cannot find the worker directory.

## Testing

pytest in `components/workerdash/tests/`:
- wire encode/decode round-trip matches the documented format
  (`redis_message_id` invariant included).
- cancel / front / retry against `fakeredis` (+ a stubbed DB layer):
  expected-use, edge (unknown id → no-op), failure (redis down → error JSON).
- `/api/state` smoke test with empty Redis and stubbed DB.
Worker-restart path is manual-test only (process manipulation).

## Housekeeping

Register the new component in CLAUDE.md (project-structure tree + a short
Components entry) in the same change, per the structure enforcement rules.

## Non-goals

No auth, no HTTPS, no historical metrics/charts, no multi-worker support,
no prod deployment, no coach/maintenance-specific actions beyond the generic
queue operations.
