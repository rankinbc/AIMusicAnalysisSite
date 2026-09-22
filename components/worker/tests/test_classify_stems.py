"""Unit test for the classify_stems dramatiq actor (write-back logic, DB + audio mocked)."""
import os
import uuid
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")

from app import tasks_dramatiq as t  # noqa: E402
from audio_analysis.stems.types import StemProposal, StemRole  # noqa: E402


class _FakeVersion:
    def __init__(self, raw, song_id=None):
        self.stem_paths_raw = raw
        self.song_id = song_id or uuid.uuid4()


class _FakeSession:
    def __init__(self, version, song=None):
        self._version = version
        self._song = song

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get(self, model, _vid):
        if model is t.Song:
            return self._song
        return self._version


def _stub_validation(monkeypatch, *, max_seconds=None, ok_seconds=30.0):
    """I6 — every stem file entering classify_stems now runs through a
    length-probe gate before decode. Tests that aren't exercising THAT gate
    stub it permissive (no real file, no DB lane lookup) so they keep
    covering their own (pre-existing) behaviour only."""
    monkeypatch.setattr(t.source_validation, "guest_max_seconds_for", lambda _uid: max_seconds)
    monkeypatch.setattr(t.source_validation, "validate_source", lambda _p, **_k: ok_seconds)


def test_classify_stems_writes_detected_roles(monkeypatch):
    raw = [
        {"id": "1", "original_filename": "a.wav", "path": "audio/stems/v/1.wav",
         "detected_role": None, "confidence": 0, "evidence": None, "confirmed_role": None},
        {"id": "2", "original_filename": "b.wav", "path": "audio/stems/v/2.wav",
         "detected_role": None, "confidence": 0, "evidence": None, "confirmed_role": None},
    ]
    version = _FakeVersion(raw)
    monkeypatch.setattr(t.SessionFactory, "begin", lambda: _FakeSession(version))
    _stub_validation(monkeypatch)

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


def test_classify_stems_hard_failure_degrades_all_to_other(monkeypatch):
    # E3.1 — a whole-actor crash (resolve/classify blowing up) must still write
    # a detected_role for EVERY entry so the BFF poll reports classified=true
    # and the review UI can fall back to manual assignment. No raise.
    raw = [
        {"id": "1", "original_filename": "a.wav", "path": "audio/stems/v/1.wav",
         "detected_role": None, "confidence": 0, "evidence": None, "confirmed_role": None},
        {"id": "2", "original_filename": "b.wav", "path": "audio/stems/v/2.wav",
         "detected_role": None, "confidence": 0, "evidence": None, "confirmed_role": None},
    ]
    version = _FakeVersion(raw)
    monkeypatch.setattr(t.SessionFactory, "begin", lambda: _FakeSession(version))
    _stub_validation(monkeypatch)

    def _boom(paths, names=None):
        raise RuntimeError("classifier import exploded")

    monkeypatch.setattr("audio_analysis.stems.classify_stems", _boom)

    t.classify_stems(str(uuid.uuid4()))  # must not raise

    assert [e["detected_role"] for e in version.stem_paths_raw] == ["other", "other"]
    assert all(e["confidence"] == 0.0 for e in version.stem_paths_raw)
    assert all(e["evidence"] == "classification unavailable" for e in version.stem_paths_raw)
    # confirmed_role stays the user's to set.
    assert version.stem_paths_raw[0]["confirmed_role"] is None


def test_classify_stems_noop_when_empty(monkeypatch):
    version = _FakeVersion([])
    monkeypatch.setattr(t.SessionFactory, "begin", lambda: _FakeSession(version))
    # Should not raise and not call the classifier.
    monkeypatch.setattr("audio_analysis.stems.classify_stems",
                        lambda paths, names=None: (_ for _ in ()).throw(AssertionError("should not classify")))
    t.classify_stems(str(uuid.uuid4()))
    assert version.stem_paths_raw == []


# ── I6 — length probe gate before decode ─────────────────────────────────────

def test_classify_stems_refuses_an_oversized_stem_before_decode(monkeypatch):
    """A guest stem over the guest cap is refused BEFORE the classifier (the
    decode function) ever sees it — the other, in-limit stem still classifies
    normally, and the refused one is mapped to role "other" with a plain
    evidence message, the same shape classify_one already uses for any other
    per-file failure. One oversized stem must not crash the whole batch."""
    raw = [
        {"id": "1", "original_filename": "a.wav", "path": "audio/stems/v/1.wav",
         "detected_role": None, "confidence": 0, "evidence": None, "confirmed_role": None},
        {"id": "2", "original_filename": "b.wav", "path": "audio/stems/v/2.wav",
         "detected_role": None, "confidence": 0, "evidence": None, "confirmed_role": None},
    ]
    owner_id = uuid.uuid4()
    song = t.Song(id=uuid.uuid4(), user_id=owner_id, name="Track")
    version = _FakeVersion(raw, song_id=song.id)
    monkeypatch.setattr(t.SessionFactory, "begin", lambda: _FakeSession(version, song))

    seen_owner_ids: list = []

    def _guest_cap(uid):
        seen_owner_ids.append(uid)
        return 720.0

    def _validate(path, *, max_seconds=None):
        assert max_seconds == 720.0
        if str(path).endswith("2.wav"):
            raise t.source_validation.InvalidFileError(
                t.source_validation.REASON_TOO_LONG, "this track is 90 minutes long"
            )
        return 30.0

    monkeypatch.setattr(t.source_validation, "guest_max_seconds_for", _guest_cap)
    monkeypatch.setattr(t.source_validation, "validate_source", _validate)

    seen_paths: list = []

    def _classify(paths, names=None):
        seen_paths.extend(str(p) for p in paths)
        return [StemProposal(Path(p), StemRole.KICK, 0.9, "spectral: ok") for p in paths]

    monkeypatch.setattr("audio_analysis.stems.classify_stems", _classify)

    t.classify_stems(str(uuid.uuid4()))  # must not raise

    assert seen_owner_ids == [owner_id]
    # The decode function never saw the refused stem...
    assert not any(p.endswith("2.wav") for p in seen_paths)
    # ...but it DID still run for the in-limit one.
    assert any(p.endswith("1.wav") for p in seen_paths)

    assert version.stem_paths_raw[0]["detected_role"] == "kick"
    assert version.stem_paths_raw[1]["detected_role"] == "other"
    assert version.stem_paths_raw[1]["confidence"] == 0.0
    assert "too_long" in version.stem_paths_raw[1]["evidence"]


def test_classify_stems_real_user_stem_within_max_passes_through(monkeypatch):
    """A non-guest owner gets the plain MAX_AUDIO_DURATION_SECONDS ceiling
    (max_seconds=None passed through) — the SAME rule the mix already
    follows — and a stem within it decodes/classifies normally."""
    raw = [
        {"id": "1", "original_filename": "a.wav", "path": "audio/stems/v/1.wav",
         "detected_role": None, "confidence": 0, "evidence": None, "confirmed_role": None},
    ]
    owner_id = uuid.uuid4()
    song = t.Song(id=uuid.uuid4(), user_id=owner_id, name="Track")
    version = _FakeVersion(raw, song_id=song.id)
    monkeypatch.setattr(t.SessionFactory, "begin", lambda: _FakeSession(version, song))
    calls: dict = {"cap": 0, "validate": 0}

    def _cap(uid):
        calls["cap"] += 1
        assert uid == owner_id
        return None

    def _validate(path, *, max_seconds=None):
        calls["validate"] += 1
        assert max_seconds is None
        return 200.0

    monkeypatch.setattr(t.source_validation, "guest_max_seconds_for", _cap)
    monkeypatch.setattr(t.source_validation, "validate_source", _validate)

    props = [StemProposal(Path("1.wav"), StemRole.KICK, 0.8, "spectral: low-band")]
    monkeypatch.setattr("audio_analysis.stems.classify_stems", lambda paths, names=None: props)

    t.classify_stems(str(uuid.uuid4()))

    # The length-probe gate must actually run (not be bypassed) for a real user too.
    assert calls == {"cap": 1, "validate": 1}
    assert version.stem_paths_raw[0]["detected_role"] == "kick"
    assert version.stem_paths_raw[0]["confidence"] == 0.8


def test_classify_stems_probe_environment_error_is_not_treated_as_a_refusal(monkeypatch):
    """Mirrors the mix's _is_environment_error contract: an ImportError/
    MemoryError/OSError during the length probe is a WORKER problem, not a
    bad stem — source_validation lets it propagate raw rather than wrapping
    it as InvalidFileError. classify_stems has no InvalidFileError-specific
    arm of its own; only the pre-existing hard-failure handler (E3.1) catches
    it, degrading every entry to "other" like any other whole-batch failure
    today — not a targeted per-stem refusal."""
    raw = [
        {"id": "1", "original_filename": "a.wav", "path": "audio/stems/v/1.wav",
         "detected_role": None, "confidence": 0, "evidence": None, "confirmed_role": None},
    ]
    version = _FakeVersion(raw)
    monkeypatch.setattr(t.SessionFactory, "begin", lambda: _FakeSession(version))
    monkeypatch.setattr(t.source_validation, "guest_max_seconds_for", lambda uid: None)

    probed: list = []

    def _env_error(path, *, max_seconds=None):
        probed.append(path)
        raise MemoryError("decode buffer allocation failed")

    monkeypatch.setattr(t.source_validation, "validate_source", _env_error)

    def _fail_if_called(paths, names=None):
        raise AssertionError("classify must never run after a probe-level environment error")

    monkeypatch.setattr("audio_analysis.stems.classify_stems", _fail_if_called)

    t.classify_stems(str(uuid.uuid4()))  # must not raise

    assert probed, "the length probe must actually run before the classifier does"
    assert version.stem_paths_raw[0]["detected_role"] == "other"
    assert version.stem_paths_raw[0]["evidence"] == "classification unavailable"
