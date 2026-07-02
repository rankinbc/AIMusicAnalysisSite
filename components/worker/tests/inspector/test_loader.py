from __future__ import annotations

import sys
import uuid
from datetime import datetime, timezone

import pytest


@pytest.fixture
def sqlite_factory(monkeypatch, tmp_path):
    """sqlite-bound app.db_sync.SessionFactory with the schema created."""
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'insp.db'}")
    saved = sys.modules.pop("app.db_sync", None)
    import app.db_sync as db_sync  # noqa: PLC0415
    from aimusic_shared.models import Base  # noqa: PLC0415

    Base.metadata.create_all(db_sync.engine)
    yield db_sync.SessionFactory
    # ALWAYS evict the sqlite-bound module AND restore the `app` package
    # attribute — they must not diverge (as-imports read the attribute;
    # from-imports read sys.modules).
    import app  # noqa: PLC0415
    sys.modules.pop("app.db_sync", None)
    if saved is not None:
        sys.modules["app.db_sync"] = saved
        app.db_sync = saved
    elif hasattr(app, "db_sync"):
        del app.db_sync


def _seed_analysis(factory, **over):
    from aimusic_shared.models import Analysis  # noqa: PLC0415
    aid = over.get("id", uuid.uuid4())
    with factory.begin() as s:
        s.add(Analysis(
            id=aid,
            job_id=over.get("job_id", uuid.uuid4()),
            user_id=uuid.uuid4(),
            song_name=over.get("song_name", "Test Song"),
            final_json=over.get("final_json", {"grade": "F", "phases": []}),
            phase_durations={},
            routing_plan=over.get("routing_plan"),
            created_at=datetime.now(timezone.utc),
        ))
    return str(aid)


def test_load_trace_returns_core_fields(sqlite_factory):
    from app.tools.inspector.loader import load_trace
    aid = _seed_analysis(sqlite_factory, song_name="Track 23-44",
                         final_json={"grade": "F", "phases": [{"phase": 1, "data": {"lufs": -9.0}}]})
    trace = load_trace(sqlite_factory, aid)
    assert trace.song_name == "Track 23-44"
    assert trace.final_json["grade"] == "F"
    assert trace.verdicts == []


def test_resolve_prefix_unique(sqlite_factory):
    from app.tools.inspector.loader import resolve_analysis_id
    aid = _seed_analysis(sqlite_factory)
    assert resolve_analysis_id(sqlite_factory, aid[:8]) == aid


def test_resolve_prefix_no_match_raises(sqlite_factory):
    from app.tools.inspector.loader import resolve_analysis_id
    _seed_analysis(sqlite_factory)
    with pytest.raises(LookupError):
        resolve_analysis_id(sqlite_factory, "ffffffff")


def test_load_trace_missing_raises(sqlite_factory):
    from app.tools.inspector.loader import load_trace
    with pytest.raises(LookupError):
        load_trace(sqlite_factory, str(uuid.uuid4()))
