"""Unit tests for the saved-reference resolution in ``analyze_audio_job``
(story: user profile of reference tracks).

Phase A of the actor resolves ``AnalysisJob.reference_id`` → the saved
``ReferenceTrack.file_path`` and passes it to ``run_pipeline`` as the Phase 5
comparison target (taking precedence over the version's one-off
``reference_path``), bumping ``used_count``. DB + audio are mocked; we capture
the kwargs handed to ``run_pipeline``.
"""
import os
import uuid

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")

from aimusic_shared.models import (  # noqa: E402
    AnalysisJob,
    ReferenceTrack,
    Song,
    SongVersion,
)
from app import tasks_dramatiq as td  # noqa: E402


class _FakeSession:
    """Stateless wrapper over a model→instance registry (same instances across begins)."""

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
def harness(monkeypatch):
    """Patches SessionFactory.begin, run_pipeline (capturing), LOCAL_ROOT, and
    the artifact writer. Returns a builder that wires a registry and runs the actor."""
    captured: dict = {}
    added: list = []

    def fake_run_pipeline(**kwargs):
        captured.update(kwargs)
        return {"phase1": {"ok": True}, "overall_score": 80.0}

    monkeypatch.setattr(td, "run_pipeline", fake_run_pipeline)
    monkeypatch.setattr(td, "LOCAL_ROOT", "/root")
    monkeypatch.setattr(td, "_try_write_artifact", lambda *a, **k: None)
    # Story 3.2: source validation runs pre-pipeline; these tests never write a real file.
    monkeypatch.setattr(td.source_validation, "validate_source", lambda _p: 180.0)
    # Don't decode audio for result images in these unit tests.
    monkeypatch.setattr(td, "render_analysis_images", lambda *a, **k: {})
    # Keep these reference tests hermetic — don't let Phase C2 hit a real DB.
    monkeypatch.setattr(td, "run_rule_engine_for_analysis", lambda _aid: 0)

    def run(registry):
        monkeypatch.setattr(td.SessionFactory, "begin", lambda: _FakeSession(registry, added))
        job = registry[AnalysisJob]
        td.analyze_audio_job(str(job.id))
        return captured, job

    return run


def _base_registry(*, reference_id, version_reference_path, reference_track):
    version_id = uuid.uuid4()
    song_id = uuid.uuid4()
    job = AnalysisJob(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        version_id=version_id,
        reference_id=reference_id,
        status="pending",
    )
    version = SongVersion(
        id=version_id,
        song_id=song_id,
        version_number=1,
        file_path="audio/upload/v/source.wav",
        reference_path=version_reference_path,
    )
    song = Song(id=song_id, user_id=job.user_id, name="Track")
    registry = {AnalysisJob: job, SongVersion: version, Song: song}
    if reference_track is not None:
        registry[ReferenceTrack] = reference_track
    return registry


def _posix(p: str | None) -> str:
    return (p or "").replace("\\", "/")


def test_saved_reference_drives_phase5_and_bumps_used_count(harness):
    ref = ReferenceTrack(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        title="Pro Track",
        source="file",
        file_path="audio/reference/abc/source.mp3",
        used_count=0,
    )
    registry = _base_registry(
        reference_id=ref.id,
        version_reference_path="audio/reference/oneoff/old.wav",  # should be overridden
        reference_track=ref,
    )

    captured, job = harness(registry)

    # The saved reference path (not the one-off) was handed to the pipeline.
    assert _posix(captured["reference_path"]).endswith("audio/reference/abc/source.mp3")
    assert ref.used_count == 1
    assert job.status == td.JOB_STATUS_COMPLETE


def test_missing_reference_falls_back_to_version_path(harness):
    # reference_id set, but the row is gone (deleted) — must fall back, not crash.
    registry = _base_registry(
        reference_id=uuid.uuid4(),
        version_reference_path="audio/reference/oneoff/old.wav",
        reference_track=None,
    )

    captured, job = harness(registry)

    assert _posix(captured["reference_path"]).endswith("audio/reference/oneoff/old.wav")
    assert job.status == td.JOB_STATUS_COMPLETE


def test_no_reference_id_is_unchanged_back_compat(harness):
    ref = ReferenceTrack(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        title="Unused",
        source="file",
        file_path="audio/reference/abc/source.mp3",
        used_count=0,
    )
    registry = _base_registry(
        reference_id=None,  # legacy / no saved reference selected
        version_reference_path="audio/reference/oneoff/old.wav",
        reference_track=ref,
    )

    captured, job = harness(registry)

    # Version's one-off reference is used; the saved reference is untouched.
    assert _posix(captured["reference_path"]).endswith("audio/reference/oneoff/old.wav")
    assert ref.used_count == 0
    assert job.status == td.JOB_STATUS_COMPLETE


def test_no_reference_anywhere_passes_none(harness):
    registry = _base_registry(
        reference_id=None,
        version_reference_path=None,
        reference_track=None,
    )

    captured, job = harness(registry)

    assert captured["reference_path"] is None
    assert job.status == td.JOB_STATUS_COMPLETE
