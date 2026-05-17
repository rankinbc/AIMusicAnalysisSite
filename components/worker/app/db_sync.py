"""Sync SQLAlchemy session factory for dramatiq actors.

Dramatiq actors are synchronous. The asyncpg-driven session in ``db.py`` is
unusable from sync code. This module wraps a plain ``psycopg2``-backed engine
and exposes a ``SessionFactory`` for the actor body.

``DATABASE_URL`` may carry the async ``+asyncpg`` driver tag (it's the same env
var the API uses); we coerce it to ``+psycopg2`` here so a single env var
works for both processes.
"""
from __future__ import annotations

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


def _sync_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL not set for dramatiq worker")
    # Normalize: dramatiq actors are sync; force psycopg2 driver.
    return url.replace("+asyncpg", "+psycopg2")


engine = create_engine(_sync_url(), pool_pre_ping=True, future=True)

SessionFactory = sessionmaker(bind=engine, expire_on_commit=False, future=True)
