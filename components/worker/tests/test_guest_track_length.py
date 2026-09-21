"""G4 fix1 item 1 — the two tests below (`test_a_guest_limit_is_enforced`,
`test_without_a_limit_the_default_applies`) are pure CHARACTERISATION tests of
`validate_source(max_seconds=...)`, which already existed and already passed
before this fix round; they are not new-behaviour RED tests. Everything below
them targets `guest_max_seconds_for`, the ONE decision function this fix round
adds (previously the guest/real-user/anon branch lived un-tested inline in
`tasks_dramatiq.analyze_audio_job`) — those started RED (AttributeError: module
'app.source_validation' has no attribute 'guest_max_seconds_for').
"""
import os
import uuid

import pytest
from app import source_validation as sv

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")


def test_a_guest_limit_is_enforced(monkeypatch, tmp_path):
    p = tmp_path / "a.wav"; p.write_bytes(b"RIFF\x00\x00\x00\x00WAVEfmt ")
    monkeypatch.setattr(sv, "_probe_duration", lambda path, fmt: 721.0)
    with pytest.raises(sv.InvalidFileError) as e:
        sv.validate_source(p, max_seconds=720)
    assert e.value.reason_code == sv.REASON_TOO_LONG
    assert "free account" in e.value.message

def test_without_a_limit_the_default_applies(monkeypatch, tmp_path):
    p = tmp_path / "a.wav"; p.write_bytes(b"RIFF\x00\x00\x00\x00WAVEfmt ")
    monkeypatch.setattr(sv, "_probe_duration", lambda path, fmt: 721.0)
    assert sv.validate_source(p) == 721.0


# ── guest_max_seconds_for — the one tested decision function (G4 fix1 #1) ────

def test_a_guest_gets_the_default_flag_value(monkeypatch):
    monkeypatch.setattr(sv, "resolve_lane", lambda uid, default: sv.GUEST_TIER)
    monkeypatch.setattr(sv.feature_flags, "get_flag_int", lambda name, default: default)
    assert sv.guest_max_seconds_for(uuid.uuid4()) == 720.0


def test_a_guest_gets_a_custom_flag_value(monkeypatch):
    monkeypatch.setattr(sv, "resolve_lane", lambda uid, default: sv.GUEST_TIER)
    monkeypatch.setattr(sv.feature_flags, "get_flag_int", lambda name, default: 300)
    assert sv.guest_max_seconds_for(uuid.uuid4()) == 300.0


def test_a_real_user_gets_no_limit(monkeypatch):
    monkeypatch.setattr(sv, "resolve_lane", lambda uid, default: default)  # not guest

    def _boom(*_a, **_k):
        raise AssertionError("a real user must never trigger a flag read")

    monkeypatch.setattr(sv.feature_flags, "get_flag_int", _boom)
    assert sv.guest_max_seconds_for(uuid.uuid4()) is None


def test_an_anonymous_device_job_gets_no_limit_without_a_lane_lookup(monkeypatch):
    def _boom(*_a, **_k):
        raise AssertionError("user_id=None is a device job — there is no user row to look up")

    monkeypatch.setattr(sv, "resolve_lane", _boom)
    assert sv.guest_max_seconds_for(None) is None


def test_a_raising_guest_lookup_fails_open_to_no_limit(monkeypatch):
    def _boom(*_a, **_k):
        raise RuntimeError("db blip")

    monkeypatch.setattr(sv, "resolve_lane", _boom)
    # A DB blip must never refuse (or shorten) a REAL user's upload; the
    # container's own memory cap is what protects the box regardless.
    assert sv.guest_max_seconds_for(uuid.uuid4()) is None


def test_a_raising_flag_read_falls_back_to_720_never_no_limit(monkeypatch):
    monkeypatch.setattr(sv, "resolve_lane", lambda uid, default: sv.GUEST_TIER)

    def _boom(*_a, **_k):
        raise RuntimeError("flags table unreachable")

    monkeypatch.setattr(sv.feature_flags, "get_flag_int", _boom)
    assert sv.guest_max_seconds_for(uuid.uuid4()) == 720.0


def test_analyze_audio_job_passes_the_guest_helper_value_through_to_validate_source(monkeypatch, tmp_path):
    from aimusic_shared.models import AnalysisJob, Song, SongVersion  # noqa: PLC0415
    from app import tasks_dramatiq as td  # noqa: PLC0415

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

    rel = "audio/u/j/source.wav"
    (tmp_path / rel).parent.mkdir(parents=True)
    (tmp_path / rel).write_bytes(b"RIFF\x00\x00\x00\x00WAVEfmt ")

    version_id, song_id, user_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    job = AnalysisJob(id=uuid.uuid4(), user_id=user_id, version_id=version_id, status="pending")
    version = SongVersion(id=version_id, song_id=song_id, version_number=1, file_path=rel)
    song = Song(id=song_id, user_id=user_id, name="Track")
    registry = {AnalysisJob: job, SongVersion: version, Song: song}

    monkeypatch.setattr(td, "LOCAL_ROOT", str(tmp_path))
    monkeypatch.setattr(td.SessionFactory, "begin", lambda: _FakeSession(registry))

    seen = {}

    def _fake_helper(uid):
        seen["helper_called_with"] = uid
        return 555.0

    def _fake_validate(_path, *, max_seconds=None):
        seen["validate_max_seconds"] = max_seconds
        raise td.source_validation.InvalidFileError(td.source_validation.REASON_TOO_LONG, "stub")

    monkeypatch.setattr(td.source_validation, "guest_max_seconds_for", _fake_helper)
    monkeypatch.setattr(td.source_validation, "validate_source", _fake_validate)

    def _pipeline_boom(**_k):
        raise AssertionError("pipeline must never run in this test")

    monkeypatch.setattr(td, "run_pipeline", _pipeline_boom)

    td.analyze_audio_job(str(job.id))  # must not raise

    assert seen["helper_called_with"] == user_id
    assert seen["validate_max_seconds"] == 555.0
