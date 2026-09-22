"""run_reference_analyzer per-reference status + retry (reference-profiles Task 3).

The actor must persist a `failed` marker (never raise) so the UI can show a Retry,
and flip to `analyzed` on success. Mirrors the run_specialist fail-marker contract.
"""
from __future__ import annotations

import uuid

from app import reference_analyzer_actor as ra


class _Ref:
    def __init__(self) -> None:
        self.user_id = uuid.uuid4()
        self.file_path = "audio/reference/x/source.wav"
        self.analyzed = False
        self.analysis_status = "pending"
        self.analysis_error = None
        self.bpm = self.detected_key = self.duration_seconds = None
        self.lufs = self.true_peak_db = self.dynamic_range_lu = None
        self.stereo_width = self.stereo_correlation = self.band_levels = None


class _FakeSession:
    """Context-manager session returning the same shared _Ref for every get()."""

    def __init__(self, ref: _Ref) -> None:
        self._ref = ref

    def __enter__(self) -> "_FakeSession":
        return self

    def __exit__(self, *_a) -> bool:
        return False

    def get(self, _model, _id):
        return self._ref


def _wire(monkeypatch, ref: _Ref) -> None:
    monkeypatch.setattr(ra.SessionFactory, "begin", lambda: _FakeSession(ref))
    monkeypatch.setattr(ra.os.path, "exists", lambda _p: True)
    # I6 — every reference now runs through a length-probe gate before phase1.
    # Tests that aren't exercising THAT gate stub it permissive (no real file,
    # no DB lane lookup) so they keep covering their own behaviour only.
    monkeypatch.setattr(ra.source_validation, "guest_max_seconds_for", lambda _uid: None)
    monkeypatch.setattr(ra.source_validation, "validate_source", lambda _p, **_k: 180.0)


def test_phase1_failure_persists_failed_marker_without_raising(monkeypatch):
    ref = _Ref()
    _wire(monkeypatch, ref)

    def _boom(_path, **_kw):  # actor passes defer_structure=True
        raise RuntimeError("decode boom")

    monkeypatch.setattr(ra.phase1_universal, "analyze", _boom)

    # Must NOT raise.
    ra.run_reference_analyzer(str(uuid.uuid4()))

    assert ref.analysis_status == "failed"
    assert "decode boom" in (ref.analysis_error or "")
    assert ref.analyzed is False


def test_success_sets_analyzed_status(monkeypatch):
    ref = _Ref()
    _wire(monkeypatch, ref)
    monkeypatch.setattr(
        ra.phase1_universal,
        "analyze",
        # actor passes defer_structure=True; envelope shape still accepted
        lambda _p, **_kw: {"data": {"bpm": 138.0, "lufs": -8.0, "rms": -16.0,
                                    "bands": {"bass": -4.0, "air": -12.0}}},
    )

    ra.run_reference_analyzer(str(uuid.uuid4()))

    assert ref.analysis_status == "analyzed"
    assert ref.analysis_error is None
    assert ref.analyzed is True
    assert ref.lufs == -8.0
    assert ref.dynamic_range_lu == 8.0  # |rms - lufs|


# ── I6 — length probe gate before decode ─────────────────────────────────────

def test_guest_reference_over_the_cap_is_refused_before_decode(monkeypatch):
    """A guest reference over the guest cap is refused BEFORE phase1 (the
    decode function) ever sees it, and persists the SAME failed-marker shape
    any other phase1 failure uses — never raises."""
    ref = _Ref()
    _wire(monkeypatch, ref)

    seen_owner_ids: list = []

    def _cap(uid):
        seen_owner_ids.append(uid)
        return 720.0

    def _refuse(_p, *, max_seconds=None):
        assert max_seconds == 720.0
        raise ra.source_validation.InvalidFileError(
            ra.source_validation.REASON_TOO_LONG, "this track is 90 minutes long"
        )

    monkeypatch.setattr(ra.source_validation, "guest_max_seconds_for", _cap)
    monkeypatch.setattr(ra.source_validation, "validate_source", _refuse)

    def _boom(*_a, **_k):
        raise AssertionError("phase1 must never decode a refused reference")

    monkeypatch.setattr(ra.phase1_universal, "analyze", _boom)

    ra.run_reference_analyzer(str(uuid.uuid4()))  # must not raise

    assert seen_owner_ids == [ref.user_id]
    assert ref.analysis_status == "failed"
    assert "too_long" in (ref.analysis_error or "")
    assert ref.analyzed is False


def test_real_user_reference_within_the_max_passes_through(monkeypatch):
    """A non-guest owner gets the plain MAX_AUDIO_DURATION_SECONDS ceiling
    (max_seconds=None passed through) — the SAME rule the mix already
    follows — and a reference within it decodes normally."""
    ref = _Ref()
    _wire(monkeypatch, ref)
    calls: dict = {"cap": 0, "validate": 0}

    def _cap(uid):
        calls["cap"] += 1
        assert uid == ref.user_id
        return None

    def _validate(_p, *, max_seconds=None):
        calls["validate"] += 1
        assert max_seconds is None
        return 180.0

    monkeypatch.setattr(ra.source_validation, "guest_max_seconds_for", _cap)
    monkeypatch.setattr(ra.source_validation, "validate_source", _validate)
    monkeypatch.setattr(
        ra.phase1_universal, "analyze",
        lambda _p, **_kw: {"data": {"bpm": 120.0, "lufs": -9.0, "rms": -15.0, "bands": {}}},
    )

    ra.run_reference_analyzer(str(uuid.uuid4()))

    assert calls == {"cap": 1, "validate": 1}
    assert ref.analysis_status == "analyzed"
    assert ref.analyzed is True


def test_a_reference_whose_header_cannot_be_probed_follows_the_mix_rule(monkeypatch):
    """An ENVIRONMENT problem during probing (e.g. no mp3 backend / disk I/O
    error) is NOT a user-content problem — source_validation deliberately
    lets it propagate raw (see _is_environment_error), same as it does for
    the mix. This actor already treats every phase1/pre-phase1 exception
    identically (persist + never raise — it has no retryable/permanent split
    like analyze_audio_job does), so the raw exception lands in the same
    _mark_failed outcome, NOT a `too_long`/InvalidFileError shape."""
    ref = _Ref()
    _wire(monkeypatch, ref)

    probed: list = []

    def _env_error(_p, *, max_seconds=None):
        probed.append(_p)
        raise MemoryError("libsndfile backend missing")

    monkeypatch.setattr(ra.source_validation, "validate_source", _env_error)

    def _boom(*_a, **_k):
        raise AssertionError("phase1 must never run when the probe itself blows up")

    monkeypatch.setattr(ra.phase1_universal, "analyze", _boom)

    ra.run_reference_analyzer(str(uuid.uuid4()))  # must not raise

    assert probed
    assert ref.analysis_status == "failed"
    assert "libsndfile backend missing" in (ref.analysis_error or "")
    assert ref.analyzed is False
