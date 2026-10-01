"""Dramatiq middleware: one log file per message, crash forensics, give-up hooks.

Everything here is best-effort — a logging failure must never fail, block or
retry a job. Every hook body is wrapped so an I/O error degrades to a console
warning.

Install FIRST in the middleware list (``install`` does it): ``emit_before``
walks the list in order and ``emit_after`` walks it REVERSED, so the first
middleware opens its run log before anyone else can skip the message, and
closes it after ``Retries`` has decided whether the message is finished for
good (``message.failed``).
"""
from __future__ import annotations

import faulthandler
import logging
import logging.handlers
import os
import threading
import time
import traceback
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import IO, Any

import dramatiq
from dramatiq.middleware import SkipMessage, TimeLimitExceeded

from .. import obs
from . import give_up, runfiles

logger = logging.getLogger(__name__)

# Actors whose arguments carry personal data — the header records the arg
# count only. send_email: (to, subject, html, ...).
REDACT_ARGS = frozenset({"send_email"})
_ARG_MAX = 200
_DEFAULT_TIME_LIMIT_MS = 600_000  # dramatiq's TimeLimit default
_HANG_DUMP_GRACE_S = 60
_POOL_LOG_BYTES = 10 * 1024 * 1024
_POOL_LOG_BACKUPS = 5


@dataclass
class _Run:
    path: Path
    handler: logging.FileHandler
    started: float
    thread_id: int
    fields: dict[str, Any] = field(default_factory=dict)


class _ThreadGate(logging.Filter):
    """Route records into a run file. With one active run (the ``--threads 1``
    norm) everything goes in — including helper threads the actor spawns. With
    several concurrent runs, only records from the run's own thread."""

    def __init__(self, mw: "RunLogMiddleware", thread_id: int) -> None:
        super().__init__()
        self._mw = mw
        self._thread_id = thread_id

    def filter(self, record: logging.LogRecord) -> bool:
        return self._mw.active_count() <= 1 or record.thread == self._thread_id


def describe_args(actor_name: str, args: Any, kwargs: Any) -> list[str]:
    if actor_name in REDACT_ARGS:
        n = len(args or ()) + len(kwargs or {})
        return [f"args: <redacted, {n} values>"]
    lines = [f"arg[{i}]: {_short(a)}" for i, a in enumerate(args or ())]
    lines += [f"kwarg[{k}]: {_short(v)}" for k, v in (kwargs or {}).items()]
    return lines


def _short(v: Any) -> str:
    s = repr(v)
    return s if len(s) <= _ARG_MAX else s[:_ARG_MAX] + f"... ({len(s)} chars)"


class RunLogMiddleware(dramatiq.Middleware):
    def __init__(self, log_dir: Path, pool: str, *, git_sha: str = "?",
                 crash_max_attempts: int = 2, retention_days: int = 14) -> None:
        self.log_dir = Path(log_dir)
        self.pool = pool
        self.git_sha = git_sha
        self.crash_max_attempts = crash_max_attempts
        self.retention_days = retention_days
        self.booted_at = time.time()
        self._runs: dict[int, _Run] = {}
        self._lock = threading.Lock()
        self._crash_file: IO[str] | None = None

    def active_count(self) -> int:
        return len(self._runs)

    # ── process boot ──────────────────────────────────────────────────────
    def after_process_boot(self, broker) -> None:  # noqa: ANN001
        """Runs in each worker process only (never the dramatiq master or a
        pytest import), so the pool log has exactly one writer."""
        self.booted_at = time.time()
        try:
            self.log_dir.mkdir(parents=True, exist_ok=True)
            pool_log = logging.handlers.RotatingFileHandler(
                self.log_dir / f"pool-{self.pool}.log", maxBytes=_POOL_LOG_BYTES,
                backupCount=_POOL_LOG_BACKUPS, encoding="utf-8")
            logging.getLogger().addHandler(obs.apply_format(pool_log))
            logging.captureWarnings(True)
            self._crash_file = open(  # noqa: SIM115 — must outlive this call
                self.log_dir / f"crash-{self.pool}.log", "a", encoding="utf-8")
            self._crash_file.write(
                f"--- process boot pid={_pid()} pool={self.pool} sha={self.git_sha} "
                f"at={datetime.now().isoformat(timespec='seconds')}\n")
            self._crash_file.flush()
            faulthandler.enable(file=self._crash_file, all_threads=True)
        except Exception:  # noqa: BLE001
            logger.warning("run logs: pool log / crash file setup failed", exc_info=True)

        try:
            for run in runfiles.sweep_dead_runs(self.log_dir, self.pool, self.booted_at):
                logger.warning(
                    "previous worker process DIED mid-run: actor=%s message=%s log=%s",
                    run.header.get("actor"), run.header.get("message_id"), run.path)
            removed = runfiles.prune_old_days(self.log_dir, self.retention_days)
            if removed:
                logger.info("run logs: pruned %d day dir(s) older than %d days",
                            len(removed), self.retention_days)
        except Exception:  # noqa: BLE001
            logger.warning("run logs: boot sweep failed", exc_info=True)
        logger.info("run logs: dir=%s pool=%s sha=%s", self.log_dir, self.pool, self.git_sha)

    # ── per message ───────────────────────────────────────────────────────
    def before_process_message(self, broker, message) -> None:  # noqa: ANN001
        try:
            crashed = runfiles.count_crashed_attempts(self.log_dir, message.message_id)
        except Exception:  # noqa: BLE001
            crashed = 0
        self._open_run(broker, message, crashed)

        if self.crash_max_attempts > 0 and crashed >= self.crash_max_attempts:
            logger.error(
                "poison guard: message %s (%s) killed the worker %d time(s) — "
                "giving up instead of crashing again",
                message.message_id, message.actor_name, crashed)
            give_up.run_hook(message.actor_name, message.args, message.kwargs,
                             give_up.REASON_WORKER_CRASHED, None)
            self._mark(reason=give_up.REASON_WORKER_CRASHED)
            message.fail()  # → dead-letter queue, inspectable/retryable later
            raise SkipMessage("poison guard: repeated worker crashes")

    def after_process_message(self, broker, message, *, result=None,  # noqa: ANN001
                              exception=None) -> None:
        if exception is None:
            self._close_run(runfiles.STATUS_OK)
            return
        timed_out = isinstance(exception, TimeLimitExceeded)
        final = bool(getattr(message, "failed", False))
        reason = give_up.REASON_TIMED_OUT if timed_out else give_up.REASON_RETRIES_EXHAUSTED
        if final:
            give_up.run_hook(message.actor_name, message.args, message.kwargs, reason, exception)
        self._close_run(
            runfiles.STATUS_TIMED_OUT if timed_out else runfiles.STATUS_FAILED,
            extra={"retry": "final" if final else "will_retry",
                   "exc": type(exception).__name__},
            body="".join(traceback.format_exception(
                type(exception), exception, exception.__traceback__)),
        )

    def after_skip_message(self, broker, message) -> None:  # noqa: ANN001
        self._close_run(runfiles.STATUS_SKIPPED)

    # ── internals ─────────────────────────────────────────────────────────
    def _open_run(self, broker, message, crashed: int) -> None:  # noqa: ANN001
        tid = threading.get_ident()
        try:
            now = datetime.now()
            path = runfiles.run_path(self.log_dir, now, message.actor_name, message.message_id)
            path.parent.mkdir(parents=True, exist_ok=True)
            handler = logging.FileHandler(path, encoding="utf-8")
            stream = handler.stream
            stream.write(runfiles.format_kv(runfiles.HEADER_PREFIX, {
                "actor": message.actor_name,
                "message_id": message.message_id,
                "queue": message.queue_name,
                "retries": message.options.get("retries", 0),
                "prior_crashes": crashed,
                "pool": self.pool,
                "pid": _pid(),
                "sha": self.git_sha,
                "started": f"{now.timestamp():.3f}",
            }) + "\n")
            for line in describe_args(message.actor_name, message.args, message.kwargs):
                stream.write(line + "\n")
            stream.flush()
            handler.addFilter(_ThreadGate(self, tid))
            obs.apply_format(handler)
            run = _Run(path=path, handler=handler, started=time.monotonic(), thread_id=tid)
            with self._lock:
                self._runs[tid] = run
            logging.getLogger().addHandler(handler)
            self._arm_faulthandler(broker, message, run)
        except Exception:  # noqa: BLE001
            logger.warning("run logs: could not open run log for %s", message.message_id,
                           exc_info=True)

    def _arm_faulthandler(self, broker, message, run: _Run) -> None:  # noqa: ANN001
        # Single-run only: faulthandler has ONE process-wide target and ONE
        # hang timer; with concurrent runs they stay on the pool crash file.
        if self.active_count() != 1:
            return
        try:
            faulthandler.enable(file=run.handler.stream, all_threads=True)
            # If the dramatiq interrupt can't fire (stuck inside C code), this
            # still dumps every thread's stack into the run log.
            faulthandler.dump_traceback_later(
                _time_limit_s(broker, message) + _HANG_DUMP_GRACE_S,
                repeat=False, file=run.handler.stream)
        except Exception:  # noqa: BLE001
            logger.debug("faulthandler arm failed", exc_info=True)

    def _mark(self, **fields: Any) -> None:
        run = self._runs.get(threading.get_ident())
        if run is not None:
            run.fields.update(fields)

    def _close_run(self, status: str, extra: dict[str, Any] | None = None,
                   body: str = "") -> None:
        with self._lock:
            run = self._runs.pop(threading.get_ident(), None)
        if run is None:
            return
        try:
            faulthandler.cancel_dump_traceback_later()
            if self._crash_file is not None:
                faulthandler.enable(file=self._crash_file, all_threads=True)
            else:  # never leave faulthandler on a file descriptor we close next
                faulthandler.disable()
        except Exception:  # noqa: BLE001
            pass
        try:
            logging.getLogger().removeHandler(run.handler)
            run.handler.close()
            fields: dict[str, Any] = {"status": status,
                                      "duration_s": f"{time.monotonic() - run.started:.2f}"}
            fields.update(run.fields)
            fields.update(extra or {})
            runfiles.append_footer(run.path, fields, body=body)
        except Exception:  # noqa: BLE001
            logger.warning("run logs: could not finish %s", run.path, exc_info=True)


def _time_limit_s(broker, message) -> float:  # noqa: ANN001
    ms = message.options.get("time_limit")
    if ms is None:
        try:
            ms = broker.get_actor(message.actor_name).options.get("time_limit")
        except Exception:  # noqa: BLE001
            ms = None
    return float(ms or _DEFAULT_TIME_LIMIT_MS) / 1000.0


def _pid() -> int:
    return os.getpid()


def install(broker, mw: RunLogMiddleware) -> None:  # noqa: ANN001
    """Put ``mw`` FIRST so its before runs first and its after runs last
    (see module docstring)."""
    if broker.middleware:
        broker.add_middleware(mw, before=type(broker.middleware[0]))
    else:
        broker.add_middleware(mw)
