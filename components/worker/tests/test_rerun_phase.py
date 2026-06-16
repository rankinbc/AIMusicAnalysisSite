"""Unit tests for the rerun_phase actor (merge-in-place + job lifecycle; DB + audio mocked)."""
import os
import uuid

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")

from aimusic_shared.models import Analysis, AnalysisJob, SongVersion  # noqa: E402
from app import rerun_phase_actor as r  # noqa: E402


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
    file_path = "audio/upload/x/source.wav"
    reference_path = None
    als_file_path = None
    stem_paths = None
    stem_analysis_mode = "grouped"


class _FakeSession:
    """Stateless wrapper over a model→instance registry; same instances across begins."""

    def __init__(self, registry):
        self._registry = registry

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get(self, model, _id):
        return self._registry.get(model)


def _registry(final_json):
    job = _Job()
    analysis = _Analysis(uuid.uuid4(), final_json)
    registry = {AnalysisJob: job, Analysis: analysis, SongVersion: _Version()}
    return registry, job, analysis


def test_rerun_phase_merges_and_completes(monkeypatch):
    final = {"phases": [{"phase": 4, "status": "ok", "data": {}, "error": None}],
             "overall_score": 70.0}
    registry, job, analysis = _registry(final)
    monkeypatch.setattr(r.SessionFactory, "begin", lambda: _FakeSession(registry))

    merged = {"phases": [{"phase": 4, "status": "ok", "data": {"x": 1}, "error": None}],
              "overall_score": 80.0, "grade": "B"}
    monkeypatch.setattr(r, "rerun_single_phase", lambda *a, **k: merged)

    r.rerun_phase(str(uuid.uuid4()), str(uuid.uuid4()), 4)

    assert job.status == "complete"
    assert job.phase_pct == 1.0
    assert job.current_phase == "complete"
    assert job.error_message is None
    # The existing analysis row was updated in place with the merged result.
    assert analysis.final_json == merged


def test_rerun_phase_failure_marks_job_and_preserves_analysis(monkeypatch):
    final = {"phases": [], "overall_score": 70.0}
    registry, job, analysis = _registry(final)
    monkeypatch.setattr(r.SessionFactory, "begin", lambda: _FakeSession(registry))

    def boom(*_a, **_k):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(r, "rerun_single_phase", boom)

    with pytest.raises(RuntimeError):
        r.rerun_phase(str(uuid.uuid4()), str(uuid.uuid4()), 5)

    assert job.status == "failed"
    assert job.error_message and "kaboom" in job.error_message
    assert job.current_phase == "failed"
    # The report must NOT be corrupted by a failed re-run.
    assert analysis.final_json == final
