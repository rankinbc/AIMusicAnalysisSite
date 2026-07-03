"""Unit tests for the result-image rendering hook in ``analyze_audio_job``.

After the pipeline runs, the actor renders a spectrogram + waveform (best-effort)
and stamps the two storage-key columns on the ``Analysis`` row. A render failure
must leave both columns None and still complete the analysis.
"""
import os
import uuid

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")

from aimusic_shared.models import (  # noqa: E402
    Analysis,
    AnalysisJob,
    Song,
    SongVersion,
)
from app import tasks_dramatiq as td  # noqa: E402

_FAKE_WEBP = b"RIFF\x00\x00\x00\x00WEBPfake"


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


def _build_registry():
    version_id = uuid.uuid4()
    song_id = uuid.uuid4()
    job = AnalysisJob(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        version_id=version_id,
        status="pending",
    )
    version = SongVersion(
        id=version_id,
        song_id=song_id,
        version_number=1,
        file_path="audio/upload/v/source.wav",
    )
    song = Song(id=song_id, user_id=job.user_id, name="Track")
    return {AnalysisJob: job, SongVersion: version, Song: song}


@pytest.fixture
def harness(monkeypatch, tmp_path):
    added: list = []
    monkeypatch.setattr(td, "run_pipeline", lambda **k: {"phase1": {"ok": True}, "overall_score": 80.0})
    monkeypatch.setattr(td, "LOCAL_ROOT", str(tmp_path))
    monkeypatch.setattr(td, "_try_write_artifact", lambda *a, **k: None)
    # Story 3.2: source validation runs pre-pipeline; these tests never write a real file.
    monkeypatch.setattr(td.source_validation, "validate_source", lambda _p: 180.0)
    monkeypatch.setattr(td, "run_rule_engine_for_analysis", lambda _aid: 0)

    def run(registry):
        monkeypatch.setattr(td.SessionFactory, "begin", lambda: _FakeSession(registry, added))
        job = registry[AnalysisJob]
        td.analyze_audio_job(str(job.id))
        analysis = next(o for o in added if isinstance(o, Analysis))
        return analysis, job

    return run, tmp_path, monkeypatch


def test_images_rendered_and_paths_set(harness):
    run, tmp_path, monkeypatch = harness
    monkeypatch.setattr(
        td, "render_analysis_images",
        lambda _p: {"spectrogram": _FAKE_WEBP, "waveform": _FAKE_WEBP},
    )
    registry = _build_registry()
    job_id = str(registry[AnalysisJob].id)

    analysis, job = run(registry)

    assert analysis.spectrogram_image_path == f"analysis/images/{job_id}/spectrogram.webp"
    assert analysis.waveform_image_path == f"analysis/images/{job_id}/waveform.webp"
    # Bytes actually landed under LOCAL_ROOT.
    assert (tmp_path / "analysis" / "images" / job_id / "spectrogram.webp").read_bytes() == _FAKE_WEBP
    assert (tmp_path / "analysis" / "images" / job_id / "waveform.webp").read_bytes() == _FAKE_WEBP
    assert job.status == td.JOB_STATUS_COMPLETE


def test_render_failure_is_swallowed(harness):
    run, _tmp_path, monkeypatch = harness

    def _boom(_p):
        raise RuntimeError("decode failed")

    monkeypatch.setattr(td, "render_analysis_images", _boom)
    registry = _build_registry()

    analysis, job = run(registry)

    assert analysis.spectrogram_image_path is None
    assert analysis.waveform_image_path is None
    assert job.status == td.JOB_STATUS_COMPLETE


def test_missing_renderer_yields_none(harness):
    run, _tmp_path, monkeypatch = harness
    monkeypatch.setattr(td, "render_analysis_images", None)
    registry = _build_registry()

    analysis, job = run(registry)

    assert analysis.spectrogram_image_path is None
    assert analysis.waveform_image_path is None
    assert job.status == td.JOB_STATUS_COMPLETE
