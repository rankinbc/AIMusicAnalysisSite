"""Phase C2 (healthy path): a successful ``analyze_audio_job`` runs the
deterministic Problem engine on the just-persisted analysis — best-effort, so a
failure there never undoes the completed analysis.

DB + audio + pipeline are mocked; the Problem engine call is a spy.
"""
import os
import uuid

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")

from aimusic_shared.models import (  # noqa: E402
    Analysis,
    AnalysisJob,
    JOB_STATUS_COMPLETE,
    Song,
    SongVersion,
)
from app import tasks_dramatiq as td  # noqa: E402


class _FakeSession:
    def __init__(self, registry, added):
        self._registry = registry
        self._added = added

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get(self, model, _id):
        return self._registry.get(model)

    def add(self, obj):
        self._added.append(obj)
        self._registry.setdefault(type(obj), obj)


@pytest.fixture
def harness(monkeypatch, tmp_path):
    added: list = []
    calls: list = []

    monkeypatch.setattr(td, "run_pipeline", lambda **k: {"phase1": {"ok": True}, "overall_score": 80.0})
    # tmp_path, not a literal "/root": on Linux CI the runner user cannot
    # stat inside /root (0700) and resolve_local raises PermissionError.
    monkeypatch.setattr(td, "LOCAL_ROOT", str(tmp_path))
    monkeypatch.setattr(td, "_try_write_artifact", lambda *a, **k: None)
    # Story 3.2: source validation runs pre-pipeline; these tests never write a real file.
    monkeypatch.setattr(td.source_validation, "validate_source", lambda _p: 180.0)
    monkeypatch.setattr(td, "render_analysis_images", lambda *a, **k: {})
    monkeypatch.setattr(td, "_enqueue_structure_detection", lambda *a, **k: None)
    monkeypatch.setattr(td, "run_rule_engine_for_analysis", lambda aid: calls.append(aid) or 1)

    def run(registry):
        monkeypatch.setattr(td.SessionFactory, "begin", lambda: _FakeSession(registry, added))
        td.analyze_audio_job(str(registry[AnalysisJob].id))
        return added, calls

    return run, monkeypatch


def _registry():
    version_id, song_id = uuid.uuid4(), uuid.uuid4()
    job = AnalysisJob(
        id=uuid.uuid4(), user_id=uuid.uuid4(), version_id=version_id, status="pending",
    )
    version = SongVersion(
        id=version_id, song_id=song_id, version_number=1,
        file_path="audio/upload/v/source.wav",
    )
    song = Song(id=song_id, user_id=job.user_id, name="Track")
    return {AnalysisJob: job, SongVersion: version, Song: song}


def test_healthy_path_runs_problem_engine_on_completed_analysis(harness):
    run, _mp = harness
    reg = _registry()
    added, calls = run(reg)

    analysis = next(o for o in added if isinstance(o, Analysis))
    assert calls == [analysis.id]  # engine invoked once, with the new analysis_id
    assert reg[AnalysisJob].status == JOB_STATUS_COMPLETE


def test_problem_engine_failure_never_fails_the_analysis(harness):
    run, mp = harness

    def boom(_aid):
        raise RuntimeError("db down")

    mp.setattr(td, "run_rule_engine_for_analysis", boom)
    reg = _registry()
    run(reg)  # must NOT raise

    # The analysis still completed despite the engine blowing up (best-effort).
    assert reg[AnalysisJob].status == JOB_STATUS_COMPLETE
