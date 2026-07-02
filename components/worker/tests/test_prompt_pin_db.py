"""Integration coverage for the REAL prompt-pin DB path (story 1.1 review).

``tests/verdict_pipeline/`` stubs ``_fetch_pin_from_db`` everywhere, so
schema drift or a symbol rename in ``app.db_sync`` / ``aimusic_shared``
would otherwise never be caught — pins would silently fail open in prod.
This test runs the genuine lazy-import + ORM query against a throwaway
sqlite database (lives OUTSIDE the stubbing conftest's package on purpose).
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest


@pytest.fixture
def sqlite_db_sync(monkeypatch, tmp_path: Path):
    """Fresh app.db_sync module bound to a throwaway sqlite file."""
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'pins.db'}")
    saved = sys.modules.pop("app.db_sync", None)
    import app.db_sync as db_sync  # re-imports against the sqlite URL

    yield db_sync

    # Restore BOTH sys.modules and the `app` package attribute — they must not
    # diverge (as-imports read the attribute; from-imports read sys.modules).
    import app  # noqa: PLC0415
    sys.modules.pop("app.db_sync", None)
    if saved is not None:
        sys.modules["app.db_sync"] = saved
        app.db_sync = saved
    elif hasattr(app, "db_sync"):
        del app.db_sync


def test_fetch_pin_from_db_real_path(sqlite_db_sync):
    from aimusic_shared.models import PromptVersion
    from app.verdict_lib.prompt_loader import _fetch_pin_from_db, clear_pin_cache

    # PromptVersion has no FKs — single-table create suffices.
    PromptVersion.__table__.create(sqlite_db_sync.engine)
    with sqlite_db_sync.SessionFactory.begin() as s:
        s.add(PromptVersion(slug="low_end", pinned_version="1.2.3"))

    clear_pin_cache()
    try:
        assert _fetch_pin_from_db("low_end") == "1.2.3"
        assert _fetch_pin_from_db("dynamics") is None
    finally:
        clear_pin_cache()
