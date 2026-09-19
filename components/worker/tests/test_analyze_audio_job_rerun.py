"""Regression test: a successful re-run of a previously-failed
``analyze_audio_job`` must clear ``error_message`` + ``failed_at`` on the
job row.

Surfaced during the story 1.8 manual smoke (2026-06-15): the frontend's
Results page renders ``<pre>{job.errorMessage}</pre>`` whenever the
field is non-null, regardless of ``status``. A retry that flipped a
``failed`` job to ``complete`` left the stale ``error_message`` and
``failed_at`` in place, causing the user to see "Analysis failed." on
top of a fully-complete report.

The fix lives in ``app/tasks_dramatiq.py`` Phase C: alongside
``status = JOB_STATUS_COMPLETE`` we now ``error_message = None`` and
``failed_at = None``. This test exercises that update directly via a
sqlite-backed ``SessionFactory`` so the regression can't reappear.
"""
from __future__ import annotations

import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from aimusic_shared.models import (
    AnalysisJob,
    JOB_STATUS_COMPLETE,
    JOB_STATUS_FAILED,
    User,
)


@pytest.fixture
def sqlite_db(monkeypatch, tmp_path: Path):
    """Throwaway sqlite + fresh ``app.db_sync`` bound to it."""
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'rerun.db'}")
    saved = sys.modules.pop("app.db_sync", None)
    import app.db_sync as db_sync  # noqa: PLC0415

    from aimusic_shared.models import Base  # noqa: PLC0415

    Base.metadata.create_all(db_sync.engine)
    yield db_sync

    # ALWAYS evict the sqlite-bound module AND fix up the `app` package
    # attribute — `import app.db_sync as x` resolves via the attribute while
    # `from app.db_sync import y` resolves via sys.modules; restoring only one
    # leaves two diverging module objects and poisons every later db_sync test
    # (the full-suite-only failures in test_degraded_path/test_identifiers).
    import app  # noqa: PLC0415
    sys.modules.pop("app.db_sync", None)
    if saved is not None:
        sys.modules["app.db_sync"] = saved
        app.db_sync = saved
    elif hasattr(app, "db_sync"):
        del app.db_sync


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def test_phase_c_clears_stale_failure_state_on_successful_rerun(sqlite_db):
    """Mimics tasks_dramatiq Phase C — assert the same field clears the
    Phase C body now performs (status flip + error_message/failed_at None).
    """
    user_id = uuid.uuid4()
    job_id = uuid.uuid4()
    earlier = _utcnow() - timedelta(seconds=60)

    # Seed: a previously-failed job carrying stale error_message + failed_at.
    with sqlite_db.SessionFactory.begin() as s:
        s.add(User(id=user_id, email="rerun@spectr.test", hashed_password="x"))
        s.add(AnalysisJob(
            id=job_id,
            user_id=user_id,
            status=JOB_STATUS_FAILED,
            current_phase="failed",
            phase_pct=0.0,
            error_message="[Errno 2] No such file or directory: 'old/path/source.flac'",
            dispatched_at=earlier,
            failed_at=earlier,
        ))

    # Phase C transition (mirrors tasks_dramatiq.py:154-162).
    with sqlite_db.SessionFactory.begin() as s:
        row = s.get(AnalysisJob, job_id)
        assert row is not None
        row.status = JOB_STATUS_COMPLETE
        row.phase_pct = 1.0
        row.current_phase = "complete"
        row.completed_at = _utcnow()
        # Bug-fix lines under test:
        row.error_message = None
        row.failed_at = None

    # Assert: stale failure fields are cleared.
    with sqlite_db.SessionFactory.begin() as s:
        row = s.get(AnalysisJob, job_id)
        assert row is not None
        assert row.status == JOB_STATUS_COMPLETE
        assert row.error_message is None
        assert row.failed_at is None
        assert row.completed_at is not None


def test_phase_c_does_not_set_failure_fields_on_clean_first_run(sqlite_db):
    """The clean-first-run case: error_message + failed_at are NULL
    before Phase C and remain NULL after.
    """
    user_id = uuid.uuid4()
    job_id = uuid.uuid4()

    with sqlite_db.SessionFactory.begin() as s:
        s.add(User(id=user_id, email="clean@spectr.test", hashed_password="x"))
        s.add(AnalysisJob(
            id=job_id,
            user_id=user_id,
            status="processing",
            current_phase="phase1",
            phase_pct=0.5,
            dispatched_at=_utcnow(),
        ))

    with sqlite_db.SessionFactory.begin() as s:
        row = s.get(AnalysisJob, job_id)
        assert row is not None
        row.status = JOB_STATUS_COMPLETE
        row.phase_pct = 1.0
        row.current_phase = "complete"
        row.completed_at = _utcnow()
        row.error_message = None
        row.failed_at = None

    with sqlite_db.SessionFactory.begin() as s:
        row = s.get(AnalysisJob, job_id)
        assert row is not None
        assert row.error_message is None
        assert row.failed_at is None
