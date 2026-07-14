"""Story 6.3 — the song-less anonymous branch of ``analyze_audio_job``.

Anon jobs carry ``device_id`` (XOR ``user_id``) and NO ``version_id``; the
audio key lives on ``analysis_jobs.file_path``. The actor must resolve the
audio from the job, skip all version/song/reference/als/stems context, and
propagate ``device_id`` (with ``song_id=None``) onto the Analysis insert so
``ck_analyses_owner_xor`` holds.
"""
import os
import uuid

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")

from aimusic_shared.models import Analysis, AnalysisJob  # noqa: E402
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


@pytest.fixture
def harness(monkeypatch, tmp_path):
    captured: dict = {}
    added: list = []

    def fake_run_pipeline(**kwargs):
        captured.update(kwargs)
        return {"phase1": {"ok": True}, "overall_score": 61.0}

    monkeypatch.setattr(td, "run_pipeline", fake_run_pipeline)
    monkeypatch.setattr(td, "LOCAL_ROOT", str(tmp_path))
    monkeypatch.setattr(td, "_try_write_artifact", lambda *a, **k: None)
    monkeypatch.setattr(td.source_validation, "validate_source", lambda _p: 120.0)
    monkeypatch.setattr(td, "render_analysis_images", lambda *a, **k: {})
    monkeypatch.setattr(td, "run_rule_engine_for_analysis", lambda _aid: 0)

    def run(registry):
        monkeypatch.setattr(td.SessionFactory, "begin", lambda: _FakeSession(registry, added))
        td.analyze_audio_job(str(registry[AnalysisJob].id))
        return captured, added

    return run


def test_songless_anon_job_runs_from_job_file_path(harness):
    device_id = "01HZZZZZZZZZZZZZZZZZZZZZZZ"
    job = AnalysisJob(
        id=uuid.uuid4(),
        user_id=None,
        device_id=device_id,
        version_id=None,
        file_path=f"audio/anon/{device_id}/{uuid.uuid4()}/source.wav",
        status="pending",
    )
    captured, added = harness({AnalysisJob: job})

    # Pipeline received the job-resolved audio path (under LOCAL_ROOT).
    assert captured["file_path"].endswith("source.wav")
    assert captured.get("reference_path") is None

    # The Analysis insert propagates device ownership, song-less.
    analyses = [a for a in added if isinstance(a, Analysis)]
    assert len(analyses) == 1
    a = analyses[0]
    assert a.device_id == device_id
    assert a.user_id is None
    assert a.version_id is None
    assert a.song_id is None
    assert job.status == "complete"


def test_songless_job_without_file_path_fails_loud(harness):
    job = AnalysisJob(
        id=uuid.uuid4(),
        user_id=None,
        device_id="01HYYYYYYYYYYYYYYYYYYYYYYY",
        version_id=None,
        file_path=None,
        status="pending",
    )
    with pytest.raises(ValueError, match="neither version_id nor file_path"):
        harness({AnalysisJob: job})
