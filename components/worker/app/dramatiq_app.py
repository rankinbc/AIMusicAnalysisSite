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
from .obs import configure_logging, init_sentry  # noqa: E402

configure_logging()
if init_sentry():
    logging.getLogger(__name__).info("sentry: enabled (worker)")

_REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

broker = RedisBroker(url=_REDIS_URL)
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
from . import recap_actor  # noqa: E402,F401
from . import fix_rack_actor  # noqa: E402,F401
from . import retention_actor  # noqa: E402,F401  (story 3.4 — sweep_retention)
from . import send_email_actor  # noqa: E402,F401  (story 4.2 — send_email)
from . import account_deletion_actor  # noqa: E402,F401  (story 4.6 — delete_account_data)

# Story 2.5 (AR23) / 3.4 / 4.2: `maintenance` carries sweep_retention +
# send_email (declared by their decorators); the explicit declare stays
# harmless and keeps W2's `--queues analysis-free maintenance` whitelist
# resolving even if the actor import order changes.
broker.declare_queue("maintenance")

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
