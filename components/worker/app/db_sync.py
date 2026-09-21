"""Sync SQLAlchemy session factory for dramatiq actors.

Dramatiq actors are synchronous, so async drivers (asyncpg) are unusable.
This module wraps a plain ``psycopg2``-backed engine and exposes a
``SessionFactory`` for actor bodies.

``DATABASE_URL`` may carry the async ``+asyncpg`` driver tag (the legacy
FastAPI api uses the same env var); we coerce it to ``+psycopg2`` here so a
single env var works for both processes.
"""
from __future__ import annotations

import os
import uuid

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


def uid_param(session, uid: uuid.UUID):
    """Normalize a ``uuid.UUID`` for a raw-SQL bind param, per dialect.

    psycopg2 adapts ``uuid.UUID`` natively (Postgres); sqlite (unit tests,
    via ``aimusic_shared`` ORM columns) stores the ORM's 32-hex form and
    can't bind ``UUID`` objects directly. Originally local to
    ``account_deletion_actor.py`` (story 4.6); moved here (D2 fix round 1)
    so ``app.llm.lane._lookup_is_guest`` can reuse it instead of
    duplicating the dialect check.
    """
    return uid if session.get_bind().dialect.name == "postgresql" else uid.hex
