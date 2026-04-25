"""Phase 1 — Universal mix analysis: LUFS, 7-band EQ balance, stereo health, BPM."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable

import librosa
import numpy as np
import pyloudnorm

logger = logging.getLogger(__name__)

# (name, mel_bin_lo, mel_bin_hi) — 128 mel bins total
_BAND_DEFS = [
    ("sub_bass", 0, 5),
    ("bass", 5, 20),
    ("low_mid", 20, 40),
    ("mid", 40, 60),
    ("upper_mid", 60, 80),
    ("presence", 80, 100),
    ("air", 100, 128),
]


def analyze(wav_path: Path, progress_cb: Callable | None = None) -> dict:
    """Run phase-1 universal analysis on *wav_path*.

    Args:
        wav_path:    Path to a 44100 Hz WAV file.
        progress_cb: Optional ``(phase, name, pct)`` progress callback.

    Returns:
        dict with keys: lufs, rms, bpm, bands, stereo_correlation,
        stereo_width, structure.
    """
    # ------------------------------------------------------------------
    # Load audio — librosa returns (channels, samples) float32 when mono=False
    # ------------------------------------------------------------------
    y, sr = librosa.load(str(wav_path), sr=44100, mono=False)

    # Ensure shape is always (channels, samples)
    if y.ndim == 1:
        y = y[np.newaxis, :]  # (1, N)

    # ------------------------------------------------------------------
    # LUFS — pyloudnorm expects (samples, channels) float64
    # CRITICAL: do NOT pass (channels, samples) — values would be silently wrong
    # ------------------------------------------------------------------
    try:
        meter = pyloudnorm.Meter(sr)
        lufs = float(meter.integrated_loudness(y.T.astype(float)))
    except Exception:
        logger.warning("pyloudnorm LUFS failed (clip too short?); defaulting to -70.0")
        lufs = -70.0

    # ------------------------------------------------------------------
    # RMS
    # ------------------------------------------------------------------
    rms = float(np.sqrt(np.mean(y**2)))

    # ------------------------------------------------------------------
    # Frequency bands (7 bands via mel spectrogram on mono mix)
    # ------------------------------------------------------------------
    mono = y.mean(axis=0) if y.ndim > 1 else y.squeeze()
    S = librosa.feature.melspectrogram(y=mono, sr=sr, n_mels=128)
    S_db = librosa.power_to_db(S, ref=np.max)
    bands: dict[str, float] = {
        name: float(S_db[lo:hi].mean()) for name, lo, hi in _BAND_DEFS
    }

    # ------------------------------------------------------------------
    # Stereo analysis
    # ------------------------------------------------------------------
    if y.ndim > 1 and y.shape[0] >= 2:
        corr_matrix = np.corrcoef(y[0], y[1])
        stereo_correlation = float(corr_matrix[0, 1])
        stereo_width = float(np.std(y[0] - y[1]))
    else:
        stereo_correlation = 1.0
        stereo_width = 0.0

    # ------------------------------------------------------------------
    # BPM
    # ------------------------------------------------------------------
    tempo, _ = librosa.beat.beat_track(y=mono, sr=sr)
    # librosa ≥0.10 returns a scalar ndarray; np.asarray().ravel() handles both scalar and array
    bpm = float(np.asarray(tempo).ravel()[0])

    # ------------------------------------------------------------------
    # Structure via all-in-one-fix (optional; requires Docker/Linux)
    # ------------------------------------------------------------------
    try:
        import all_in_one_fix  # type: ignore[import]

        structure = all_in_one_fix.analyze(str(wav_path))
    except (ImportError, Exception):
        structure = {"sections": [], "beats": []}

    return {
        "lufs": lufs,
        "rms": rms,
        "bpm": bpm,
        "bands": bands,
        "stereo_correlation": stereo_correlation,
        "stereo_width": stereo_width,
        "structure": structure,
    }
