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


def test_rerun_phase_genre_hint_cascades_across_2_3_5_6(monkeypatch):
    """Item 1: correcting the genre must re-run phases 2/3/5/6 in sequence
    (NOT just phase 2 alone), and must refresh rule-engine findings since
    the verdict-layer genre_map depends on the corrected genre."""
    final = {"phases": [{"phase": 2, "status": "ok", "data": {"genre": "house"}, "error": None}],
             "overall_score": 70.0}
    registry, job, analysis = _registry(final)
    monkeypatch.setattr(r.SessionFactory, "begin", lambda: _FakeSession(registry))

    calls: list[tuple] = []

    def fake_rerun_single_phase(phase_num, _file, prior, **kwargs):
        calls.append((phase_num, kwargs.get("genre_hint")))
        return {"phases": [{"phase": phase_num, "status": "ok", "data": {}, "error": None}],
                "overall_score": 70.0 + phase_num, "grade": "B"}

    monkeypatch.setattr(r, "rerun_single_phase", fake_rerun_single_phase)

    rule_engine_calls: list[tuple] = []
    import app.verdict_lib.degraded as degraded_mod
    monkeypatch.setattr(
        degraded_mod, "run_rule_engine_for_analysis",
        lambda aid, force=False: rule_engine_calls.append((aid, force)),
    )

    r.rerun_phase(str(uuid.uuid4()), str(uuid.uuid4()), 2, genre_hint="techno")

    assert [c[0] for c in calls] == [2, 3, 5, 6]
    # genre_hint only forwarded on the phase-2 leg of the cascade.
    assert calls[0][1] == "techno"
    assert calls[1][1] is None and calls[2][1] is None and calls[3][1] is None
    assert len(rule_engine_calls) == 1
    assert rule_engine_calls[0][1] is True  # force=True
    assert job.status == "complete"


def test_rerun_phase_without_genre_hint_stays_single_phase(monkeypatch):
    """A bare phase-2 re-run (no genre_hint) must NOT cascade — back-compat
    with the existing single-phase rerun behavior."""
    final = {"phases": [{"phase": 2, "status": "ok", "data": {"genre": "house"}, "error": None}],
             "overall_score": 70.0}
    registry, job, analysis = _registry(final)
    monkeypatch.setattr(r.SessionFactory, "begin", lambda: _FakeSession(registry))

    calls: list[int] = []

    def fake_rerun_single_phase(phase_num, _file, prior, **kwargs):
        calls.append(phase_num)
        return {"phases": [{"phase": phase_num, "status": "ok", "data": {}, "error": None}],
                "overall_score": 75.0, "grade": "B"}

    monkeypatch.setattr(r, "rerun_single_phase", fake_rerun_single_phase)

    rule_engine_calls: list[tuple] = []
    import app.verdict_lib.degraded as degraded_mod
    monkeypatch.setattr(
        degraded_mod, "run_rule_engine_for_analysis",
        lambda aid, force=False: rule_engine_calls.append((aid, force)),
    )

    r.rerun_phase(str(uuid.uuid4()), str(uuid.uuid4()), 2)

    assert calls == [2]
    assert rule_engine_calls == []


def test_rerun_phase_6_reference_profile_override_stays_single_phase(monkeypatch):
    """The pre-existing phase-6 reference-profile override must be unaffected
    by the genre-cascade addition."""
    final = {"phases": [{"phase": 6, "status": "ok", "data": {}, "error": None}],
             "overall_score": 70.0}
    registry, job, analysis = _registry(final)
    monkeypatch.setattr(r.SessionFactory, "begin", lambda: _FakeSession(registry))

    calls: list[tuple] = []

    def fake_rerun_single_phase(phase_num, _file, prior, **kwargs):
        calls.append((phase_num, kwargs.get("reference_profile")))
        return {"phases": [{"phase": phase_num, "status": "ok", "data": {}, "error": None}],
                "overall_score": 82.0, "grade": "B"}

    monkeypatch.setattr(r, "rerun_single_phase", fake_rerun_single_phase)

    profile = {"kind": "genre", "genre": "techno"}
    r.rerun_phase(str(uuid.uuid4()), str(uuid.uuid4()), 6, reference_profile=profile)

    assert calls == [(6, profile)]


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
