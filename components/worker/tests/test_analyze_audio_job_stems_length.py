"""I6 — the stems AND the one-off reference handed to run_pipeline from
``analyze_audio_job`` (the "analysis path", as opposed to the classify_stems
actor's pre-analysis "classify path" and the standalone run_reference_analyzer
actor) are length-probed the same way the mix already is, before phase 4/5 can
decode them. An over-limit input is DROPPED, never raised as a job-level
InvalidFileError — phase 4 already tolerates a partial/absent stem set (see
``phase4_stems._analyze_user_stems``'s own try/except), and dropping a
one-off reference is the same as the version never having had one — so the
whole analysis must not fail over one bad stem or reference.
"""
import os
import uuid

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")

from aimusic_shared.models import AnalysisJob, Song, SongVersion  # noqa: E402
from app import tasks_dramatiq as td  # noqa: E402


class _FakeSession:
    def __init__(self, registry):
        self._registry = registry

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get(self, model, _id):
        return self._registry.get(model)

    def add(self, _obj):
        pass


def _registry(*, stem_paths=None, reference_path=None):
    version_id, song_id, user_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    job = AnalysisJob(id=uuid.uuid4(), user_id=user_id, version_id=version_id, status="pending")
    version = SongVersion(
        id=version_id, song_id=song_id, version_number=1,
        file_path="audio/upload/v/source.wav",
        stem_paths=stem_paths, reference_path=reference_path,
    )
    song = Song(id=song_id, user_id=user_id, name="Track")
    return {AnalysisJob: job, SongVersion: version, Song: song}


def _harness(monkeypatch, tmp_path):
    captured: dict = {}

    def fake_run_pipeline(**kwargs):
        captured.update(kwargs)
        return {"phase1": {"ok": True}, "overall_score": 80.0}

    monkeypatch.setattr(td, "run_pipeline", fake_run_pipeline)
    monkeypatch.setattr(td, "LOCAL_ROOT", str(tmp_path))
    monkeypatch.setattr(td, "_try_write_artifact", lambda *a, **k: None)
    monkeypatch.setattr(td, "render_analysis_images", lambda *a, **k: {})
    monkeypatch.setattr(td, "run_rule_engine_for_analysis", lambda _aid: 0)
    monkeypatch.setattr(td.source_validation, "guest_max_seconds_for", lambda _uid: None)
    return captured


def test_an_oversized_stem_is_dropped_not_raised(monkeypatch, tmp_path):
    registry = _registry(stem_paths={
        "kick": ["audio/stems/v/1.wav"], "bass": ["audio/stems/v/2.wav"],
    })
    captured = _harness(monkeypatch, tmp_path)
    monkeypatch.setattr(td.SessionFactory, "begin", lambda: _FakeSession(registry))

    def _validate(path, *, max_seconds=None):
        if str(path).endswith("2.wav"):
            raise td.source_validation.InvalidFileError(
                td.source_validation.REASON_TOO_LONG, "too long"
            )
        return 30.0

    monkeypatch.setattr(td.source_validation, "validate_source", _validate)

    td.analyze_audio_job(str(registry[AnalysisJob].id))  # must not raise

    assert "kick" in captured["stem_paths"]
    assert "bass" not in captured["stem_paths"]
    job = registry[AnalysisJob]
    assert job.status == td.JOB_STATUS_COMPLETE
    assert job.error_code is None


def test_all_stems_oversized_leaves_stem_paths_none(monkeypatch, tmp_path):
    registry = _registry(stem_paths={"kick": ["audio/stems/v/1.wav"]})
    captured = _harness(monkeypatch, tmp_path)
    monkeypatch.setattr(td.SessionFactory, "begin", lambda: _FakeSession(registry))

    def _refuse_stems_only(path, *, max_seconds=None):
        # endswith, not a bare substring match — tmp_path itself is derived
        # from this test's own name and can coincidentally contain "stems".
        if str(path).endswith("1.wav"):
            raise td.source_validation.InvalidFileError(td.source_validation.REASON_TOO_LONG, "too long")
        return 30.0  # the mix itself must still pass

    monkeypatch.setattr(td.source_validation, "validate_source", _refuse_stems_only)

    td.analyze_audio_job(str(registry[AnalysisJob].id))  # must not raise

    assert captured["stem_paths"] is None
    assert registry[AnalysisJob].status == td.JOB_STATUS_COMPLETE


def test_an_oversized_one_off_reference_is_dropped_not_raised(monkeypatch, tmp_path):
    registry = _registry(reference_path="audio/reference/oneoff/big.wav")
    captured = _harness(monkeypatch, tmp_path)
    monkeypatch.setattr(td.SessionFactory, "begin", lambda: _FakeSession(registry))

    def _refuse_reference_only(path, *, max_seconds=None):
        if str(path).endswith("big.wav"):
            raise td.source_validation.InvalidFileError(td.source_validation.REASON_TOO_LONG, "too long")
        return 30.0  # the mix itself must still pass

    monkeypatch.setattr(td.source_validation, "validate_source", _refuse_reference_only)

    td.analyze_audio_job(str(registry[AnalysisJob].id))  # must not raise

    assert captured["reference_path"] is None
    job = registry[AnalysisJob]
    assert job.status == td.JOB_STATUS_COMPLETE
    assert job.error_code is None
