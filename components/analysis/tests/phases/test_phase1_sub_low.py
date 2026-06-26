"""Phase-1 sub-30 Hz energy (B3 lift) — splits an infrasonic/rumble band out of
the existing 20-200 Hz low band so the `sub_rumble` rule can flag headroom waste
below ~30 Hz. The 20-200 Hz `low_energy` value is preserved byte-for-byte.
"""
from __future__ import annotations

import numpy as np

from audio_analysis.phases.phase1_universal import _low_band_energies


def _tone(*freqs: float, sr: int = 44100, secs: float = 2.0) -> np.ndarray:
    t = np.arange(int(secs * sr)) / sr
    return sum(0.3 * np.sin(2 * np.pi * f * t) for f in freqs)


def test_returns_both_low_and_sub30():
    e = _low_band_energies(_tone(25.0, 100.0), 44100)
    assert set(e) == {"low_energy", "sub_30_energy"}
    assert all(isinstance(v, float) for v in e.values())


def test_sub30_high_with_rumble():
    e = _low_band_energies(_tone(20.0), 44100)  # 20 Hz rumble
    assert e["sub_30_energy"] > 0.0


def test_sub30_low_without_rumble():
    # 100 Hz only → sub-30 energy far below the 20-200 Hz low band.
    e = _low_band_energies(_tone(100.0), 44100)
    assert e["sub_30_energy"] < e["low_energy"]
