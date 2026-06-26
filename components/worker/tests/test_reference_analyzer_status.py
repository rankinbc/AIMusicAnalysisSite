"""run_reference_analyzer per-reference status + retry (reference-profiles Task 3).

The actor must persist a `failed` marker (never raise) so the UI can show a Retry,
and flip to `analyzed` on success. Mirrors the run_specialist fail-marker contract.
"""
from __future__ import annotations

import uuid

from app import reference_analyzer_actor as ra


class _Ref:
    def __init__(self) -> None:
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


def test_phase1_failure_persists_failed_marker_without_raising(monkeypatch):
    ref = _Ref()
    _wire(monkeypatch, ref)

    def _boom(_path):
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
        lambda _p: {"data": {"bpm": 138.0, "lufs": -8.0, "rms": -16.0,
                             "bands": {"bass": -4.0, "air": -12.0}}},
    )

    ra.run_reference_analyzer(str(uuid.uuid4()))

    assert ref.analysis_status == "analyzed"
    assert ref.analysis_error is None
    assert ref.analyzed is True
    assert ref.lufs == -8.0
    assert ref.dynamic_range_lu == 8.0  # |rms - lufs|
