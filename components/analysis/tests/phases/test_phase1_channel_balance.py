"""Phase-1 channel balance (B5 lift) — per-channel L/R RMS, the datapoint the
`channel_imbalance` rule needs (supersedes the weak A14 proxy). The spec named
the "2x2 correlation matrix" but that carries no energy; per-channel RMS does.
"""
from __future__ import annotations

import numpy as np

from audio_analysis.phases.phase1_universal import _channel_balance


def _stereo(l_amp: float, r_amp: float, sr: int = 44100, secs: float = 1.0) -> np.ndarray:
    t = np.arange(int(secs * sr)) / sr
    return np.vstack([l_amp * np.sin(2 * np.pi * 200 * t), r_amp * np.sin(2 * np.pi * 200 * t)])


def test_channel_balance_detects_left_louder():
    cb = _channel_balance(_stereo(0.4, 0.2))
    assert cb["balance_db"] > 0  # + = left louder
    assert cb["l_rms_db"] > cb["r_rms_db"]


def test_channel_balance_balanced_stereo_near_zero():
    cb = _channel_balance(_stereo(0.3, 0.3))
    assert abs(cb["balance_db"]) < 0.01


def test_channel_balance_mono_is_zero():
    mono = np.array([[0.3] * 1000])  # (1, N)
    cb = _channel_balance(mono)
    assert cb["balance_db"] == 0.0


def test_channel_balance_values_are_json_safe_floats():
    cb = _channel_balance(_stereo(0.4, 0.2))
    assert all(isinstance(v, float) for v in cb.values())
