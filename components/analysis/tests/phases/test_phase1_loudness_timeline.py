"""Phase-1 loudness timeline (B1 lift) — the momentary (0.4 s) / short-term (3 s)
loudness series that `_windowed_loudness` already builds for the LRA calc and
then discards, now surfaced (decimated, time-aligned).
"""
from __future__ import annotations

import numpy as np

from audio_analysis.phases.phase1_universal import _windowed_loudness


def _tone(secs: float = 4.0, sr: int = 44100, freq: float = 200.0) -> np.ndarray:
    t = np.arange(int(secs * sr)) / sr
    return np.vstack([0.3 * np.sin(2 * np.pi * freq * t)] * 2)  # (2, N) stereo


def test_windowed_loudness_returns_time_aligned_series():
    _lra, _st, _m, timeline = _windowed_loudness(_tone(), 44100, -14.0)
    assert set(timeline) >= {"momentary", "short_term"}
    for seg in ("momentary", "short_term"):
        s = timeline[seg]
        assert set(s) == {"t", "lufs"}
        assert len(s["t"]) == len(s["lufs"])
        assert all(isinstance(x, float) for x in s["t"])
        assert all(isinstance(x, float) for x in s["lufs"])


def test_momentary_max_equals_series_max():
    _lra, _st, m_max, timeline = _windowed_loudness(_tone(), 44100, -14.0)
    if timeline["momentary"]["lufs"]:
        assert abs(m_max - max(timeline["momentary"]["lufs"])) < 1e-6


def test_short_clip_has_empty_short_term_series():
    # 0.1 s is shorter than a 3 s short-term window → no short-term points.
    _lra, _st, _m, timeline = _windowed_loudness(_tone(secs=0.1), 44100, -14.0)
    assert timeline["short_term"]["lufs"] == []
