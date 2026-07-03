"""Story 3.5 (NFR16) — a redelivered message for an already-completed job is
a clean no-op: no status regression, no pipeline re-run, no second analyses
insert attempt (the unique analyses.job_id index would turn that into an
IntegrityError retry-loop)."""
import os
import uuid

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")

from aimusic_shared.models import (  # noqa: E402
    JOB_STATUS_COMPLETE,
    AnalysisJob,
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


def test_completed_job_redelivery_is_a_noop(monkeypatch, tmp_path):
    version_id, song_id = uuid.uuid4(), uuid.uuid4()
    job = AnalysisJob(
        id=uuid.uuid4(), user_id=uuid.uuid4(), version_id=version_id,
        status=JOB_STATUS_COMPLETE, current_phase="complete", phase_pct=1.0,
    )
    registry = {
        AnalysisJob: job,
        SongVersion: SongVersion(id=version_id, song_id=song_id, version_number=1, file_path="x.wav"),
        Song: Song(id=song_id, user_id=job.user_id, name="T"),
    }
    added: list = []
    monkeypatch.setattr(td, "LOCAL_ROOT", str(tmp_path))
    monkeypatch.setattr(td.SessionFactory, "begin", lambda: _FakeSession(registry, added))

    def _boom(**_k):
        raise AssertionError("pipeline must not run for a completed job")

    monkeypatch.setattr(td, "run_pipeline", _boom)
    monkeypatch.setattr(
        td.source_validation, "validate_source",
        lambda _p: (_ for _ in ()).throw(AssertionError("validation must not run")),
    )

    td.analyze_audio_job(str(job.id))  # must return cleanly

    assert job.status == JOB_STATUS_COMPLETE   # no regression to processing
    assert job.phase_pct == 1.0
    assert added == []                          # no second analyses row attempted


def test_reaper_failed_job_redelivery_is_a_noop(monkeypatch, tmp_path):
    """A job the reaper already failed (worker_unavailable) must NOT be
    silently resurrected by a late message — the user was told to re-run,
    and a resurrection could double-run against that manual retry."""
    from aimusic_shared.models import JOB_STATUS_FAILED

    version_id, song_id = uuid.uuid4(), uuid.uuid4()
    job = AnalysisJob(
        id=uuid.uuid4(), user_id=uuid.uuid4(), version_id=version_id,
        status=JOB_STATUS_FAILED, error_code="worker_unavailable",
        current_phase="failed",
    )
    registry = {
        AnalysisJob: job,
        SongVersion: SongVersion(id=version_id, song_id=song_id, version_number=1, file_path="x.wav"),
        Song: Song(id=song_id, user_id=job.user_id, name="T"),
    }
    added: list = []
    monkeypatch.setattr(td, "LOCAL_ROOT", str(tmp_path))
    monkeypatch.setattr(td.SessionFactory, "begin", lambda: _FakeSession(registry, added))
    monkeypatch.setattr(
        td, "run_pipeline",
        lambda **_k: (_ for _ in ()).throw(AssertionError("pipeline must not run")),
    )

    td.analyze_audio_job(str(job.id))

    assert job.status == JOB_STATUS_FAILED     # stays failed — no resurrection
    assert added == []
