"""Unit test for the classify_stems dramatiq actor (write-back logic, DB + audio mocked)."""
import os
import uuid
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")

from app import tasks_dramatiq as t  # noqa: E402
from audio_analysis.stems.types import StemProposal, StemRole  # noqa: E402


class _FakeVersion:
    def __init__(self, raw):
        self.stem_paths_raw = raw


class _FakeSession:
    def __init__(self, version):
        self._version = version

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get(self, _model, _vid):
        return self._version


def test_classify_stems_writes_detected_roles(monkeypatch):
    raw = [
        {"id": "1", "original_filename": "a.wav", "path": "audio/stems/v/1.wav",
         "detected_role": None, "confidence": 0, "evidence": None, "confirmed_role": None},
        {"id": "2", "original_filename": "b.wav", "path": "audio/stems/v/2.wav",
         "detected_role": None, "confidence": 0, "evidence": None, "confirmed_role": None},
    ]
    version = _FakeVersion(raw)
    monkeypatch.setattr(t.SessionFactory, "begin", lambda: _FakeSession(version))

    props = [
        StemProposal(Path("1.wav"), StemRole.KICK, 0.7, "spectral: low-band"),
        StemProposal(Path("2.wav"), StemRole.BASS, 0.7, "spectral: sustained"),
    ]
    seen: dict = {}

    def _fake(paths, names=None):
        seen["names"] = names
        return props

    monkeypatch.setattr("audio_analysis.stems.classify_stems", _fake)

    t.classify_stems(str(uuid.uuid4()))

    assert version.stem_paths_raw[0]["detected_role"] == "kick"
    assert version.stem_paths_raw[1]["detected_role"] == "bass"
    assert version.stem_paths_raw[0]["confidence"] == 0.7
    assert "spectral" in version.stem_paths_raw[0]["evidence"]
    # confirmed_role is the user's job at confirm time — classify must not set it.
    assert version.stem_paths_raw[0]["confirmed_role"] is None
    # Authoritative export names are forwarded for filename-first classification.
    assert seen["names"] == ["a.wav", "b.wav"]


def test_classify_stems_noop_when_empty(monkeypatch):
    version = _FakeVersion([])
    monkeypatch.setattr(t.SessionFactory, "begin", lambda: _FakeSession(version))
    # Should not raise and not call the classifier.
    monkeypatch.setattr("audio_analysis.stems.classify_stems",
                        lambda paths, names=None: (_ for _ in ()).throw(AssertionError("should not classify")))
    t.classify_stems(str(uuid.uuid4()))
    assert version.stem_paths_raw == []
