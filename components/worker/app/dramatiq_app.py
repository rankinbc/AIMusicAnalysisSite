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

logging.basicConfig(level=logging.INFO)

_REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

broker = RedisBroker(url=_REDIS_URL)
dramatiq.set_broker(broker)

# Side effect: registers actors with the broker.
from . import tasks_dramatiq  # noqa: E402,F401
from . import verdict_actor  # noqa: E402,F401
from . import triage_actor  # noqa: E402,F401
from . import reference_analyzer_actor  # noqa: E402,F401
from . import coach_actor  # noqa: E402,F401
from . import rerun_phase_actor  # noqa: E402,F401
from . import structure_actor  # noqa: E402,F401

# Story 2.5 (AR23): the `maintenance` queue carries no actor yet (Epic 3/4 add
# sweep_retention / send_email). Declare it explicitly so W2's
# `--queues analysis-free maintenance` whitelist resolves to a live (empty)
# consumer today rather than an inert entry. Benign: nothing produces to it yet.
broker.declare_queue("maintenance")
