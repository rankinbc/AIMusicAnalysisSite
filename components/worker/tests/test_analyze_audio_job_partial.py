"""Live analysis page — ``analyze_audio_job`` merges each phase's result slice +
duration (and phase 1's early sub-results) into ``analysis_jobs.partial_json``
as the pipeline reports them. Best-effort: a failing write never fails the job.
"""
import os
import uuid
from datetime import datetime, timezone

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")

from aimusic_shared.models import (  # noqa: E402
    Analysis,
    AnalysisJob,
    Song,
    SongVersion,
)
from app import live_partial  # noqa: E402
from app import tasks_dramatiq as td  # noqa: E402


class _FakeSession:
    def __init__(self, registry, added, fail_partial=False):
        self._registry = registry
        self._added = added
        self._fail_partial = fail_partial

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get(self, model, _id):
        obj = self._registry.get(model)
        if self._fail_partial and model is AnalysisJob and obj is not None and obj.status == "processing":
            return _ExplodingJob(obj)
        return obj

    def add(self, obj):
        self._added.append(obj)


class _ExplodingJob:
    """Proxy whose partial_json write raises (simulates a DB hiccup)."""

    def __init__(self, job):
        object.__setattr__(self, "_job", job)

    def __getattr__(self, name):
        return getattr(self._job, name)

    def __setattr__(self, name, value):
        if name == "partial_json":
            raise RuntimeError("db hiccup")
        setattr(self._job, name, value)


def _registry():
    version_id = uuid.uuid4()
    song_id = uuid.uuid4()
    job = AnalysisJob(id=uuid.uuid4(), user_id=uuid.uuid4(), version_id=version_id, status="pending")
    job.partial_json = {"v": 1, "phases": {"9": {"name": "stale"}}}  # from a crashed earlier attempt
    version = SongVersion(id=version_id, song_id=song_id, version_number=1, file_path="audio/upload/v/source.wav")
    song = Song(id=song_id, user_id=job.user_id, name="Track")
    return {AnalysisJob: job, SongVersion: version, Song: song}


def _fake_pipeline(snapshots):
    """Mimics run_pipeline's callback order: progress start → early phase-1
    sub-results → phase done; then phase 2 start + done."""

    def run(**kw):
        progress, done = kw["progress_cb"], kw["phase_done_cb"]
        job_ref = snapshots["job"]
        progress(1, "Universal Mix Analysis", 0.0)
        done(1, "Universal Mix Analysis", {"lufs": -11.9, "duration_seconds": 200.0}, None)
        snapshots["after_early"] = dict(job_ref.partial_json or {})
        done(1, "Universal Mix Analysis", {"bpm": 128.0}, None)
        done(
            1,
            "Universal Mix Analysis",
            {
                "phase": 1, "name": "Universal Mix Analysis", "status": "ok", "error": None,
                "duration_s": 54.4,
                "data": {"lufs": -11.9, "bpm": 128.0, "loudness_timeline": {"t": list(range(500))},
                         "bands": {"sub": -20.0}, "nan_metric": float("nan")},
            },
            54.4,
        )
        snapshots["after_p1"] = dict(job_ref.partial_json or {})
        progress(2, "Genre Detection", 0.0)
        done(2, "Genre Detection",
             {"phase": 2, "status": "failed", "data": {}, "error": "boom", "duration_s": 1.2}, 1.2)
        return {"phases": [], "overall_score": 80.0}

    return run


@pytest.fixture
def harness(monkeypatch, tmp_path):
    monkeypatch.setattr(td, "LOCAL_ROOT", str(tmp_path))
    monkeypatch.setattr(td, "_try_write_artifact", lambda *a, **k: None)
    monkeypatch.setattr(td.source_validation, "validate_source", lambda _p, **_k: 180.0)
    monkeypatch.setattr(td, "run_rule_engine_for_analysis", lambda _aid: 0)
    monkeypatch.setattr(td, "render_analysis_images", None)

    def run(fail_partial=False):
        registry = _registry()
        added: list = []
        snaps: dict = {"job": registry[AnalysisJob]}
        monkeypatch.setattr(td, "run_pipeline", _fake_pipeline(snaps))
        monkeypatch.setattr(
            td.SessionFactory, "begin", lambda: _FakeSession(registry, added, fail_partial)
        )
        td.analyze_audio_job(str(registry[AnalysisJob].id))
        return registry[AnalysisJob], snaps, added

    return run


def test_partial_json_written_per_phase_with_durations(harness):
    job, snaps, added = harness()

    # Early phase-1 sub-results land before the phase finishes; the stale
    # partial from a previous attempt was reset in Phase A.
    early = snaps["after_early"]
    assert early["early"]["1"]["lufs"] == -11.9
    assert "phases" not in early
    assert early["running"]["phase"] == 1

    p1 = snaps["after_p1"]["phases"]["1"]
    assert p1["seconds"] == 54.4
    assert p1["status"] == "ok"
    assert p1["data"]["lufs"] == -11.9
    assert "loudness_timeline" not in p1["data"]  # heavy series dropped
    assert p1["data"]["nan_metric"] is None  # JSONB-safe
    assert snaps["after_p1"]["early"]["1"]["bpm"] == 128.0

    final = job.partial_json
    assert final["v"] == 1
    assert set(final["phases"]) == {"1", "2"}
    assert final["phases"]["2"] == {
        "name": "Genre Detection", "status": "failed", "seconds": 1.2, "data": {}, "error": "boom",
    }
    assert final["running"]["phase"] == 2
    datetime.fromisoformat(final["running"]["started_at"])
    assert job.status == td.JOB_STATUS_COMPLETE
    assert any(isinstance(o, Analysis) for o in added)


def test_partial_json_write_failure_is_harmless(harness):
    job, _snaps, added = harness(fail_partial=True)
    assert job.status == td.JOB_STATUS_COMPLETE
    assert any(isinstance(o, Analysis) for o in added)


def test_merge_helpers_are_pure_and_bounded():
    prior = {"v": 1, "phases": {"1": {"name": "x"}}}
    out = live_partial.merge_phase(
        prior, 4, "Stem Separation & Clash",
        {"status": "ok", "data": {"clashes": [{"stems": f"a/{i}"} for i in range(20)],
                                  "series": list(range(100)), "few": [1, 2, 3]}},
        2.345,
    )
    assert prior == {"v": 1, "phases": {"1": {"name": "x"}}}  # not mutated
    d = out["phases"]["4"]["data"]
    assert len(d["clashes"]) == 8
    assert "series" not in d
    assert d["few"] == [1, 2, 3]
    assert out["phases"]["4"]["seconds"] == 2.35
    assert set(out["phases"]) == {"1", "4"}

    run = live_partial.merge_running(None, 3, "Genre-Specific Scoring", datetime(2026, 1, 1, tzinfo=timezone.utc))
    assert run == {"v": 1, "running": {"phase": 3, "name": "Genre-Specific Scoring",
                                       "started_at": "2026-01-01T00:00:00+00:00"}}
    assert live_partial.merge_early("garbage", 1, {"bpm": 120.0}) == {"v": 1, "early": {"1": {"bpm": 120.0}}}
