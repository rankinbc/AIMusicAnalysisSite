"""Dramatiq broker + actor registration entry point.

Run via:

    python -m dramatiq app.dramatiq_app

This module is intentionally small — it wires the Redis broker and imports
``tasks_dramatiq`` so the ``@dramatiq.actor`` decorators register their actors
with the global broker.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

# Load the worker's .env BEFORE any module imports os.environ. db_sync.py
# reads DATABASE_URL at import time; without this, Windows-native runs
# (no docker) would fail with "DATABASE_URL not set" even when the var
# is configured in .env. python-dotenv is a transitive dep of
# pydantic-settings — already in the venv.
try:
    from dotenv import load_dotenv

    _ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
    if _ENV_PATH.exists():
        load_dotenv(_ENV_PATH, override=False)
except ImportError:
    pass  # dotenv missing → caller must export env vars manually

import dramatiq
from dramatiq.brokers.redis import RedisBroker

# Story 10.3 — correlation-stamped logging + DSN-gated Sentry replace the
# bare basicConfig; the Prometheus middleware exposes the dramatiq metrics
# exporter (+ our custom counters from obs.py) when enabled.
from .obs import configure_logging, init_sentry, make_correlation_reset_middleware  # noqa: E402

configure_logging()
if init_sentry():
    logging.getLogger(__name__).info("sentry: enabled (worker)")

_REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

if os.environ.get("DRAMATIQ_BROKER") == "stub":
    # Test suites only (tests/conftest.py): an in-memory broker so importing
    # this module never dials Redis — see the conftest for why that matters.
    from dramatiq.brokers.stub import StubBroker

    broker = StubBroker()
else:
    broker = RedisBroker(url=_REDIS_URL)
broker.add_middleware(make_correlation_reset_middleware())
if os.environ.get("WORKER_METRICS", "").strip() == "1":
    from dramatiq.middleware.prometheus import Prometheus

    # Exporter binds dramatiq_prom_host/dramatiq_prom_port (default
    # 127.0.0.1:9191; prod compose sets host 0.0.0.0 for the scraper).
    broker.add_middleware(Prometheus())
dramatiq.set_broker(broker)

# Side effect: registers actors with the broker.
from . import tasks_dramatiq  # noqa: E402,F401
from . import verdict_actor  # noqa: E402,F401
from . import triage_actor  # noqa: E402,F401
from . import reference_analyzer_actor  # noqa: E402,F401
from . import coach_actor  # noqa: E402,F401
from . import rerun_phase_actor  # noqa: E402,F401
from . import structure_actor  # noqa: E402,F401
from . import fix_rack_actor  # noqa: E402,F401
from . import retention_actor  # noqa: E402,F401  (story 3.4 — sweep_retention)
from . import send_email_actor  # noqa: E402,F401  (story 4.2 — send_email)
from . import account_deletion_actor  # noqa: E402,F401  (story 4.6 — delete_account_data)

# Per-run log files + crash forensics + give-up hooks
# (PRPs/archive/2026-10-01_worker-run-logs-and-crash-forensics.md). Installed FIRST in the
# middleware list; the hooks import the actor modules, so this follows them.
import sys as _sys  # noqa: E402

from .runlog import config as _runlog_config  # noqa: E402
from .runlog import hooks as _runlog_hooks  # noqa: E402,F401  (registers give-up hooks)
from .runlog.middleware import RunLogMiddleware, install as _install_runlog  # noqa: E402

_install_runlog(broker, RunLogMiddleware(
    _runlog_config.log_dir(tasks_dramatiq.LOCAL_ROOT),
    _runlog_config.pool_name(argv=_sys.argv),
    git_sha=_runlog_config.git_sha(),
    crash_max_attempts=_runlog_config.int_env(
        "WORKER_CRASH_MAX_ATTEMPTS", _runlog_config.DEFAULT_CRASH_MAX_ATTEMPTS),
    retention_days=_runlog_config.int_env(
        "WORKER_LOG_RETENTION_DAYS", _runlog_config.DEFAULT_RETENTION_DAYS),
))

# Story 2.5 (AR23) / 3.4 / 4.2: `maintenance` carries sweep_retention +
# send_email (declared by their decorators); the explicit declare stays
# harmless and keeps W2's `--queues analysis-free maintenance` whitelist
# resolving even if the actor import order changes.
broker.declare_queue("maintenance")

# Interactive AI lane: run_triage, run_specialist and generate_fix_rack
# declare `ai` so they never queue behind batch DSP (a multi-minute
# analyze_audio_job / allin1 structure run) on the batch worker. The
# interactive pool consumes `coach ai` with several threads — those actors are
# I/O-bound LLM calls (STARTUP.md #3b). Declared explicitly for the same
# import-order reason as `maintenance`. `analysis-paid` is declared too:
# run_triage/run_specialist/generate_fix_rack messages enqueued there BEFORE
# the move still dispatch by actor_name, so the batch pool keeps a consumer on
# that queue that drains them (rerun_phase etc. declare it today; this keeps
# that true even if they move later).
broker.declare_queue("ai")
# `ai-guest`: the demo guests' copy of the same three actors (BFF
# GuestLimits.AiQueueFor). No actor declares it — dispatch is by actor_name —
# so it MUST be declared here or the small guest-AI worker's
# `--queues ai-guest` whitelist attaches no consumer and guest triage is
# orphaned. Prod runs it as its own one-thread worker (worker-guest-ai).
broker.declare_queue("ai-guest")
broker.declare_queue("analysis-paid")

# Story 4.2 review — prod email gate, WORKER side. The BFF's
# SPECTR_REQUIRE_EMAIL check validates the BFF's Resend options, but the
# component that actually SENDS is this worker via RESEND_API_KEY. Without
# this, a configured-BFF/unconfigured-worker deploy passes the gate and every
# prod email silently becomes a stub log line.
import os as _os  # noqa: E402

if _os.environ.get("SPECTR_REQUIRE_EMAIL") == "1" and not _os.environ.get("RESEND_API_KEY", "").strip():
    raise RuntimeError(
        "SPECTR_REQUIRE_EMAIL=1 but RESEND_API_KEY is not set — the send_email "
        "actor would stub every email. Set RESEND_API_KEY on the worker."
    )

# Story 12.2 (AC5) — one boot summary of the worker-owned knobs. Values only,
# never secrets: REDIS_URL may embed a password, so log host:port only;
# DATABASE_URL is never logged. Story 12.3 (AC3) appends the resolved storage
# root + results dir (the line 12-2 deliberately deferred) and warns when the
# root is missing — the classic symptom of a compose-only
# STORAGE_LOCAL_ROOT=/data leaking into a native run.
from urllib.parse import urlparse as _urlparse  # noqa: E402

from .llm.settings import get_llm_settings as _get_llm_settings  # noqa: E402

_redis_loc = _urlparse(_REDIS_URL)
# get_llm_settings() validates every LLM_* env var; a malformed value must not
# turn this log line into a boot crash — the LLM gateway will surface the real
# error on first use, exactly as it did before this summary existed.
try:
    _llm_fake = "1" if _get_llm_settings().llm_fake else "0"
except Exception:  # noqa: BLE001
    _llm_fake = "?"
_storage_fragment, _storage_warning = tasks_dramatiq.storage_boot_summary(
    tasks_dramatiq.LOCAL_ROOT, str(tasks_dramatiq.RESULTS_DIR)
)
logging.getLogger(__name__).info(
    "Boot config: LLM_FAKE=%s WORKER_METRICS=%s redis=%s:%s queues=%s %s",
    _llm_fake,
    "1" if os.environ.get("WORKER_METRICS", "").strip() == "1" else "0",
    _redis_loc.hostname or "localhost",
    _redis_loc.port or 6379,
    ",".join(sorted(broker.get_declared_queues())),
    _storage_fragment,
)
if _storage_warning:
    logging.getLogger(__name__).warning("%s", _storage_warning)
