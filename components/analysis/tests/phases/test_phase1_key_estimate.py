"""Phase-1 key/mode estimate (B4 lift) — the full 24-key Krumhansl vector
surfaced from the intermediate the confidence calc already computes.

Pure-function tests (no audio decode): exercise `_key_estimate(chroma_mean)`.
"""
from __future__ import annotations

import numpy as np

from audio_analysis.phases.phase1_universal import (
    _KEY_NAMES,
    _KRUMHANSL_MAJOR,
    _key_estimate,
)


def test_key_estimate_on_clear_c_major_chroma():
    # A chroma shaped exactly like the C-major Krumhansl profile → key C, major, conf ~1.
    est = _key_estimate(_KRUMHANSL_MAJOR.copy())
    assert est["key"] == "C"
    assert est["mode"] == "major"
    assert est["confidence"] > 0.9
    assert len(est["profile_corrs"]) == 24
    assert est["second_key"] in _KEY_NAMES
    assert est["second_mode"] in ("major", "minor")


def test_key_estimate_key_matches_chroma_argmax():
    # `key` is derived from the chroma argmax (== the existing detected_key),
    # so the two never diverge regardless of the Krumhansl correlations.
    cm = np.zeros(12)
    cm[7] = 1.0  # G dominant
    est = _key_estimate(cm)
    assert est["key"] == _KEY_NAMES[7]  # "G"


def test_key_estimate_flat_chroma_is_zero_confidence():
    est = _key_estimate(np.ones(12))
    assert est["confidence"] == 0.0
    assert len(est["profile_corrs"]) == 24


def test_key_estimate_corrs_are_json_safe_floats():
    est = _key_estimate(_KRUMHANSL_MAJOR.copy())
    assert all(isinstance(c, float) for c in est["profile_corrs"])
    assert isinstance(est["confidence"], float)


def test_analyze_emits_key_estimate_matching_detected_key(tmp_path):
    """The lift is wired into the phase-1 return, and never diverges from the
    existing detected_key / key_detection_confidence."""
    import soundfile as sf

    from audio_analysis.phases import phase1_universal

    sr = 44100
    t = np.arange(2 * sr) / sr
    audio = 0.3 * np.sin(2 * np.pi * 261.63 * t) + 0.15 * np.sin(2 * np.pi * 523.25 * t)
    wav = tmp_path / "c.wav"
    sf.write(wav, audio.astype(np.float32), sr)

    out = phase1_universal.analyze(wav, defer_structure=True)
    assert "key_estimate" in out
    assert out["key_estimate"]["key"] == out["detected_key"]
    assert out["key_estimate"]["confidence"] == out["key_detection_confidence"]
    assert len(out["key_estimate"]["profile_corrs"]) == 24
