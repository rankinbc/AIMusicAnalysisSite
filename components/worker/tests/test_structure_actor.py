"""Unit tests for the detect_structure_job actor (merge-in-place + job lifecycle; DB + allin1 mocked)."""
import os
import uuid

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")

from aimusic_shared.models import Analysis, AnalysisJob, SongVersion  # noqa: E402
from app import structure_actor as st  # noqa: E402


class _Job:
    def __init__(self):
        self.status = "pending"
        self.current_phase = ""
        self.phase_pct = 0.0
        self.started_at = None
        self.completed_at = None
        self.failed_at = None
        self.error_message = "prev"


class _Analysis:
    def __init__(self, version_id, final_json):
        self.version_id = version_id
        self.final_json = final_json


class _Version:
    def __init__(self, file_path="audio/upload/x/source.wav"):
        self.file_path = file_path


class _FakeSession:
    def __init__(self, registry):
        self._registry = registry

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get(self, model, _id):
        return self._registry.get(model)


def _registry(final_json, version=None):
    job = _Job()
    analysis = _Analysis(uuid.uuid4(), final_json)
    registry = {
        AnalysisJob: job,
        Analysis: analysis,
        SongVersion: version if version is not None else _Version(),
    }
    return registry, job, analysis


def test_detect_structure_merges_and_completes(monkeypatch):
    final = {"phases": [{"phase": 1, "status": "ok", "data": {}, "error": None}],
             "overall_score": 70.0}
    registry, job, analysis = _registry(final)
    monkeypatch.setattr(st.SessionFactory, "begin", lambda: _FakeSession(registry))

    merged = {"phases": [{"phase": 7, "status": "ok", "data": {"grade": "B"}, "error": None}],
              "overall_score": 70.0}
    monkeypatch.setattr(st, "detect_structure_and_rescore", lambda *a, **k: merged)

    st.detect_structure_job(str(uuid.uuid4()), str(uuid.uuid4()))

    assert job.status == "complete"
    assert job.phase_pct == 1.0
    assert job.error_message is None
    assert analysis.final_json == merged


def test_detect_structure_failure_marks_job_and_preserves_analysis(monkeypatch):
    final = {"phases": [], "overall_score": 70.0}
    registry, job, analysis = _registry(final)
    monkeypatch.setattr(st.SessionFactory, "begin", lambda: _FakeSession(registry))

    def boom(*_a, **_k):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(st, "detect_structure_and_rescore", boom)

    with pytest.raises(RuntimeError):
        st.detect_structure_job(str(uuid.uuid4()), str(uuid.uuid4()))

    assert job.status == "failed"
    assert job.error_message and "kaboom" in job.error_message
    assert analysis.final_json == final  # report not corrupted


def test_detect_structure_failure_writes_arrangement_failed(monkeypatch):
    # E5.1 — a crash must flip the report's still-'pending' Phase 7 to 'failed'
    # so the frontend's arrangement poll terminates on an honest state.
    final = {"phases": [{"phase": 7, "status": "ok",
                         "data": {"arrangement_status": "pending"}, "error": None}],
             "overall_score": 70.0}
    registry, job, analysis = _registry(final)
    monkeypatch.setattr(st.SessionFactory, "begin", lambda: _FakeSession(registry))

    def boom(*_a, **_k):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(st, "detect_structure_and_rescore", boom)

    with pytest.raises(RuntimeError):
        st.detect_structure_job(str(uuid.uuid4()), str(uuid.uuid4()))

    assert job.status == "failed"
    p7 = analysis.final_json["phases"][0]["data"]
    assert p7["arrangement_status"] == "failed"
    assert "kaboom" in p7["arrangement_error"]


def test_detect_structure_failure_never_clobbers_scored_phase7(monkeypatch):
    # Idempotence: only a still-'pending' status is flipped — a completed
    # rerun's scored Phase 7 must survive a later retry's crash untouched.
    final = {"phases": [{"phase": 7, "status": "ok",
                         "data": {"arrangement_status": "scored", "grade": "A"},
                         "error": None}],
             "overall_score": 70.0}
    registry, job, analysis = _registry(final)
    monkeypatch.setattr(st.SessionFactory, "begin", lambda: _FakeSession(registry))

    def boom(*_a, **_k):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(st, "detect_structure_and_rescore", boom)

    with pytest.raises(RuntimeError):
        st.detect_structure_job(str(uuid.uuid4()), str(uuid.uuid4()))

    p7 = analysis.final_json["phases"][0]["data"]
    assert p7["arrangement_status"] == "scored"
    assert "arrangement_error" not in p7


def test_detect_structure_missing_job_is_noop(monkeypatch):
    # Stale/orphaned message: the structure-job row doesn't exist. Should no-op
    # (not raise → no pointless retries) and never run allin1.
    registry = {}  # _FakeSession.get returns None for every model
    monkeypatch.setattr(st.SessionFactory, "begin", lambda: _FakeSession(registry))

    def must_not_run(*_a, **_k):
        raise AssertionError("should not run allin1 for a missing structure job")

    monkeypatch.setattr(st, "detect_structure_and_rescore", must_not_run)

    st.detect_structure_job(str(uuid.uuid4()), str(uuid.uuid4()))  # no raise


def test_detect_structure_no_audio_marks_failed_without_running(monkeypatch):
    final = {"phases": [], "overall_score": 70.0}
    registry, job, analysis = _registry(final, version=_Version(file_path=None))
    monkeypatch.setattr(st.SessionFactory, "begin", lambda: _FakeSession(registry))

    def must_not_run(*_a, **_k):
        raise AssertionError("should not run allin1 without source audio")

    monkeypatch.setattr(st, "detect_structure_and_rescore", must_not_run)

    st.detect_structure_job(str(uuid.uuid4()), str(uuid.uuid4()))  # no raise

    assert job.status == "failed"
    assert "Source audio missing" in (job.error_message or "")
