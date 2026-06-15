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
