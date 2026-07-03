"""Story 3.2 (AR19/AR16) — analyze_audio_job fails fast with the typed
error_code='invalid_file' on a spoofed source, without raising (no dramatiq
retry: the bytes are permanently bad), so the BFF's reversal hook can refund.
"""
import os
import struct
import uuid
import wave

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")

from aimusic_shared.models import (  # noqa: E402
    Analysis,
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


def _registry(file_path: str):
    version_id = uuid.uuid4()
    song_id = uuid.uuid4()
    job = AnalysisJob(id=uuid.uuid4(), user_id=uuid.uuid4(), version_id=version_id, status="pending")
    version = SongVersion(id=version_id, song_id=song_id, version_number=1, file_path=file_path)
    song = Song(id=song_id, user_id=job.user_id, name="Track")
    return {AnalysisJob: job, SongVersion: version, Song: song}


def _harness(monkeypatch, tmp_path, registry, added):
    monkeypatch.setattr(td, "LOCAL_ROOT", str(tmp_path))
    monkeypatch.setattr(td, "_try_write_artifact", lambda *a, **k: None)
    monkeypatch.setattr(td, "run_rule_engine_for_analysis", lambda _aid: 0)
    monkeypatch.setattr(td, "render_analysis_images", lambda _p: {})
    monkeypatch.setattr(td.SessionFactory, "begin", lambda: _FakeSession(registry, added))


def test_spoofed_file_fails_typed_without_raising(monkeypatch, tmp_path):
    rel = "audio/u/j/source.wav"
    junk = tmp_path / rel
    junk.parent.mkdir(parents=True)
    junk.write_bytes(b"MZ\x90\x00" + b"\x00" * 64)  # a PE header, not audio

    registry = _registry(rel)
    added: list = []
    _harness(monkeypatch, tmp_path, registry, added)

    def _boom(**_k):
        raise AssertionError("pipeline must never run for an invalid file")

    monkeypatch.setattr(td, "run_pipeline", _boom)

    td.analyze_audio_job(str(registry[AnalysisJob].id))  # must NOT raise

    job = registry[AnalysisJob]
    assert job.status == "failed"
    assert job.error_code == "invalid_file"
    assert "bad_magic_bytes" in (job.error_message or "")
    assert not any(isinstance(o, Analysis) for o in added)  # no analysis row


def test_valid_file_still_completes_with_no_error_code(monkeypatch, tmp_path):
    rel = "audio/u/j/source.wav"
    ok = tmp_path / rel
    ok.parent.mkdir(parents=True)
    frames = 5 * 8000
    with wave.open(str(ok), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(struct.pack(f"<{frames}h", *([0] * frames)))

    registry = _registry(rel)
    added: list = []
    _harness(monkeypatch, tmp_path, registry, added)
    monkeypatch.setattr(td, "run_pipeline", lambda **k: {"phase1": {"ok": True}, "overall_score": 80.0})

    td.analyze_audio_job(str(registry[AnalysisJob].id))

    job = registry[AnalysisJob]
    assert job.status == "complete"
    assert job.error_code is None
    assert any(isinstance(o, Analysis) for o in added)
