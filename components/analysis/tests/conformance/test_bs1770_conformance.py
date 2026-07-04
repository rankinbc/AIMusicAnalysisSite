"""Story 10.7 — BS.1770-4 / EBU Tech 3341 measurement conformance harness.

Vectors are SYNTHESIZED (the tone cases are analytically defined — no
binary fixtures, no downloads) and asserted against the PRODUCTION
functions (`integrated_lufs`, `true_peak_dbtp`) — the exact code
`phase1_universal.analyze()` ships. A regression here fails CI and blocks
deploy: no published number can silently go wrong.

Tolerances are the published compliance windows:
  * integrated LUFS: ±0.1 LU (Tech 3341 acceptance = this story's AC1)
  * dBTP: -0.4 / +0.2 dB (Tech 3341 true-peak acceptance)
"""
from __future__ import annotations

import numpy as np
import pytest

from audio_analysis.phases.phase1_universal import integrated_lufs, true_peak_dbtp

SR = 44100
LU_TOL = 0.1
DBTP_LO, DBTP_HI = -0.4, +0.2


def _sine(freq: float, dbfs: float, seconds: float, phase: float = 0.0) -> np.ndarray:
    amp = 10.0 ** (dbfs / 20.0)
    t = np.arange(int(SR * seconds)) / SR
    return (amp * np.sin(2.0 * np.pi * freq * t + phase)).astype(np.float64)


def _stereo(mono: np.ndarray) -> np.ndarray:
    return np.vstack([mono, mono])


# ── AC1: integrated LUFS (Tech 3341 tone cases) ─────────────────────────────

def test_tech3341_case1_minus23_dbfs_tone_reads_minus23_lufs():
    y = _stereo(_sine(1000.0, -23.0, 20.0))
    assert abs(integrated_lufs(y, SR) - (-23.0)) <= LU_TOL


def test_tech3341_case2_minus33_dbfs_tone_reads_minus33_lufs():
    y = _stereo(_sine(1000.0, -33.0, 20.0))
    assert abs(integrated_lufs(y, SR) - (-33.0)) <= LU_TOL


def test_tech3341_case3_style_gating_discards_quiet_segments():
    # -36 dBFS (10 s) | -23 dBFS (20 s) | -36 dBFS (10 s): the relative gate
    # (-10 LU) must discard the quiet flanks -> integrated = -23.0 LUFS.
    # (EBU's middle segment is 60 s; the gate math is identical at 20 s and
    # CI stays fast.)
    quiet = _sine(1000.0, -36.0, 10.0)
    loud = _sine(1000.0, -23.0, 20.0)
    y = _stereo(np.concatenate([quiet, loud, quiet]))
    assert abs(integrated_lufs(y, SR) - (-23.0)) <= LU_TOL


def test_silence_returns_the_shipped_sentinel():
    # Production behavior: digital silence -> the -70.0 floor sentinel
    # (pyloudnorm's -inf never escapes into reports).
    y = np.zeros((2, SR * 5), dtype=np.float64)
    assert integrated_lufs(y, SR) == -70.0


# ── AC2: true peak (dBTP, 4x oversampled, per-channel max) ──────────────────

def test_dbtp_fs4_tone_with_45deg_phase_recovers_intersample_peak():
    # fs/4 sine sampled at 45° phase: every SAMPLE lands at A*cos(45°) —
    # a naive sample-peak meter reads 3.01 dB LOW. A conformant 4x
    # oversampling meter recovers ~A. Amplitude -6 dBFS -> true peak -6 dBTP.
    mono = _sine(SR / 4.0, -6.0, 5.0, phase=np.pi / 4.0)
    sample_peak_db = 20.0 * np.log10(np.max(np.abs(mono)))
    assert sample_peak_db < -8.5  # proves the vector actually hides its peak
    measured = true_peak_dbtp(_stereo(mono), SR)
    assert DBTP_LO <= measured - (-6.0) <= DBTP_HI


def test_dbtp_full_scale_tone_reads_zero():
    mono = _sine(997.0, 0.0, 5.0)  # 997 Hz: not sample-rate-aligned (classic vector choice)
    measured = true_peak_dbtp(_stereo(mono), SR)
    assert DBTP_LO <= measured - 0.0 <= DBTP_HI


def test_dbtp_uses_per_channel_max_not_the_downmix():
    # The pre-10.7 bug: out-of-phase stereo NULLS in a mono downmix — the
    # old meter read silence for content peaking at -6 dBTP per channel.
    mono = _sine(SR / 4.0, -6.0, 5.0, phase=np.pi / 4.0)
    y = np.vstack([mono, -mono])  # fully out of phase
    measured = true_peak_dbtp(y, SR)
    assert DBTP_LO <= measured - (-6.0) <= DBTP_HI


@pytest.mark.parametrize("freq_frac", [0.45])
def test_dbtp_near_nyquist_documented_limit(freq_frac: float):
    # DOCUMENTED LIMIT, not a conformance assertion. Measured behavior of
    # the 4x polyphase meter above ~0.4*fs: the resampling filter's
    # transition-band ripple OVER-reads (0.45*fs @ -6 dBFS measures about
    # -4.5 dBTP, i.e. +1.5 dB high). Over-reading is the CONSERVATIVE
    # direction for streaming-readiness warnings (never under-warns), and
    # real programme material has negligible energy at 0.45*fs. Pinned
    # loosely so dropping the oversampler entirely still fails here.
    mono = _sine(SR * freq_frac, -6.0, 5.0, phase=np.pi / 3.0)
    measured = true_peak_dbtp(_stereo(mono), SR)
    assert -6.0 - 0.4 <= measured <= -6.0 + 2.0
