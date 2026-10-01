# PRP — Worker run logs + crash forensics

Status: executing (2026-10-01) on `feat/worker-run-logs` (off `origin/solo`).

## Why

The dramatiq worker is the least reliable part of the stack, and its failures
leave **no trace**: it logs only to the console of a PowerShell window, and
`data/logs/` is empty on every worktree. The worst failure modes (STARTUP.md
#3 half-dead, #4 stuck pending, #8 OpenMP abort) are native/process deaths, so
no Python `except` ever runs. We cannot fix crashes we cannot see.

Audit findings that shape the design:

1. **`TimeLimitExceeded` is a `BaseException`** (dramatiq 2.1: `Interrupt ->
   BaseException`). Every actor's terminal-state write sits in an
   `except Exception` arm, so a time-limit kill skips it: jobs stay
   `processing` until the BFF `StaleJobReaper`, coach bubbles stay `pending`,
   specialist tiles never get a fail-marker, references stay "analyzing".
2. **Native crashes have no retry cap.** A segfault/abort leaves the message
   unacked; Redis redelivers it with the SAME `message_id` to the restarted
   worker, which crashes again on the same input — a crash loop that
   dramatiq's `max_retries` never sees.
3. Each actor hand-rolls its failure write; there is no shared "this message
   is done for good" hook.

## What

All in `components/worker/app/runlog/` (new package), wired from
`dramatiq_app.py`. Every piece is best-effort: a logging failure must never
fail or block a job.

### 1. Per-run log files
`RunLogMiddleware` opens `<log_dir>/runs/<YYYY-MM-DD>/<HHMMSS-mmm>_<actor>_<message_id>.log`
in `before_process_message`:
- header: actor, message id, queue, retry n, pool, pid, git sha, args
  (each truncated to 200 chars; `send_email` args redacted — PII).
- attaches a `FileHandler` to the root logger for the run (all threads while
  one run is active; filtered by thread if >1 run is active).
- `after_process_message` / `after_skip_message`: footer
  `=== END status=<ok|failed|timed_out|skipped> duration=<s>` + traceback.

### 2. Crash forensics
- `faulthandler` points at the active run's file during a run (native
  segfault/abort stack lands in the run log) and at `<log_dir>/crash-<pool>.log`
  between runs.
- `faulthandler.dump_traceback_later(time_limit + 60s)` per run: if the
  dramatiq interrupt can't fire (stuck in C code), we still get the stacks.
- **Boot sweep** (`after_process_boot`): run logs of THIS pool with no footer
  whose pid is not a live process started before the run get a footer
  `status=died` and a WARNING in the pool log. Also deletes day dirs older than
  `WORKER_LOG_RETENTION_DAYS` (default 14).
- **Poison guard** (`before_process_message`): if this `message_id` already
  has ≥ `WORKER_CRASH_MAX_ATTEMPTS` (default 2) unfinished/died run logs, the
  message is skipped and the actor's give-up hook runs with reason
  `worker_crashed`.

### 3. Persistent pool log
`<log_dir>/pool-<pool>.log`, `RotatingFileHandler` 10 MB × 5, same
correlation-id format as the console. Pool name: `WORKER_POOL` →
`WORKER_QUEUES` (prod compose) → `--queues` argv → `all`. Added in
`after_process_boot` so only real worker processes write it (not the dramatiq
master, not pytest imports).

`log_dir`: `WORKER_LOG_DIR`, default `<LOCAL_ROOT>/logs/worker` — i.e. repo
`data/logs/worker/` in dev (already gitignored, next to the watchdog's logs)
and `/data/logs/worker/` on the prod volume.

### 4. Give-up hooks
`runlog.give_up` registry: `@on_give_up("actor_name")` functions receive
`(args, kwargs, reason, exc)` and write an idempotent terminal state. The
middleware calls them when a message is finished for good: `message.failed`
after an exception (retries exhausted / timed out), or the poison guard.
Hooks for: `analyze_audio_job`, `rerun_phase`, `detect_structure_job`,
`classify_stems`, `run_specialist`, `run_reference_analyzer`, `coach_reply`.
Job rows: only flip non-terminal rows, never overwrite an existing
`error_code`; codes `timed_out` / `worker_crashed` / `retries_exhausted`.

### 5. workerdash
`/api/runlogs` (list, filter by date/status/actor/correlation) and
`/api/runlogs/<date>/<name>` (raw text), plus a "Run logs" panel; `died` and
`failed` runs highlighted.

## Out of scope (follow-up)
- Running librosa/torch phases in a child subprocess so a native crash kills
  one job, not the worker (needs the crash data this PRP produces first).
- Watchdog on by default in `start-spectr.ps1`.
- Capturing fd-level stderr of native libs (OMP prints to the console only).

## Validation
- `pytest -q components/worker/tests/` (new `test_runlog_*.py`: header/footer,
  status mapping, boot sweep, poison guard, give-up hook dispatch + idempotency,
  retention)
- `pytest -q components/workerdash/tests/`
- `ruff check components/worker/ components/workerdash/`
- Live: start the stack, run an analysis, confirm a run log + pool log; kill
  the worker mid-run, restart, confirm `status=died` footer.
