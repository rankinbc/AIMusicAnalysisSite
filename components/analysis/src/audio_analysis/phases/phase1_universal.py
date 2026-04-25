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

_KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def analyze(wav_path: Path, progress_cb: Callable | None = None) -> dict:
    """Run phase-1 universal analysis on *wav_path*.

    Args:
        wav_path:    Path to a 44100 Hz WAV file.
        progress_cb: Optional ``(phase, name, pct)`` progress callback.

    Returns:
        dict with keys: lufs, rms, bpm, duration_seconds, bands, stereo_correlation,
        stereo_width, true_peak_db, peak_dbfs, clipping_detected, clipped_sample_count,
        detected_key, mono_compatibility, low_energy, structure.
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
    # RMS + duration
    # ------------------------------------------------------------------
    rms = float(np.sqrt(np.mean(y**2)))
    duration_seconds = float(y.shape[1] / sr)

    # ------------------------------------------------------------------
    # Mono downmix — reused for most single-channel computations
    # ------------------------------------------------------------------
    mono = y.mean(axis=0) if y.ndim > 1 else y.squeeze()

    # ------------------------------------------------------------------
    # Frequency bands (7 bands via mel spectrogram)
    # ------------------------------------------------------------------
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
    # True peak — 4x oversampling to detect inter-sample peaks (dBTP)
    # Falls back to simple peak if scipy is unavailable.
    # ------------------------------------------------------------------
    try:
        from scipy import signal as scipy_signal
        oversampled = scipy_signal.resample_poly(mono, 4, 1)
        true_peak_linear = float(np.max(np.abs(oversampled)))
    except Exception:
        true_peak_linear = float(np.max(np.abs(mono)))
    true_peak_db = float(20.0 * np.log10(true_peak_linear + 1e-9))

    # ------------------------------------------------------------------
    # Peak dBFS + clipping detection
    # Clipping threshold: |sample| >= 0.9999 (hard clip at digital full scale)
    # ------------------------------------------------------------------
    peak_linear = float(np.max(np.abs(y)))
    peak_dbfs = float(20.0 * np.log10(peak_linear + 1e-9))
    clipped_samples = int(np.sum(np.abs(y) >= 0.9999))
    clipping_detected = clipped_samples > 0
    clipped_sample_count = clipped_samples

    # ------------------------------------------------------------------
    # BPM
    # ------------------------------------------------------------------
    tempo, _ = librosa.beat.beat_track(y=mono, sr=sr)
    # librosa ≥0.10 returns a scalar ndarray; .ravel() handles both scalar and array
    bpm = float(np.asarray(tempo).ravel()[0])

    # ------------------------------------------------------------------
    # Musical key detection via constant-Q chromagram
    # ------------------------------------------------------------------
    chroma = librosa.feature.chroma_cqt(y=mono, sr=sr)
    chroma_mean = chroma.mean(axis=1)
    detected_key = _KEY_NAMES[int(np.argmax(chroma_mean))]

    # ------------------------------------------------------------------
    # Mono compatibility — ratio of mono-sum RMS to stereo RMS
    # A value close to 1.0 means the mix survives mono well.
    # ------------------------------------------------------------------
    if y.ndim > 1 and y.shape[0] >= 2:
        mono_sum = y.mean(axis=0)
        stereo_rms = float(np.sqrt(np.mean(y ** 2)))
        mono_rms = float(np.sqrt(np.mean(mono_sum ** 2)))
        mono_compatibility = float(np.clip(mono_rms / (stereo_rms + 1e-9), 0.0, 1.0))
    else:
        mono_compatibility = 1.0

    # ------------------------------------------------------------------
    # Low-frequency energy (20–200 Hz band) — input for danceability scorer
    # ------------------------------------------------------------------
    stft_mag = np.abs(librosa.stft(mono))
    freqs = librosa.fft_frequencies(sr=sr)
    low_band_mask = (freqs >= 20) & (freqs <= 200)
    low_energy = float(np.sqrt(np.mean(stft_mag[low_band_mask, :] ** 2)))

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
        "duration_seconds": duration_seconds,
        "bands": bands,
        "stereo_correlation": stereo_correlation,
        "stereo_width": stereo_width,
        "true_peak_db": true_peak_db,
        "peak_dbfs": peak_dbfs,
        "clipping_detected": clipping_detected,
        "clipped_sample_count": clipped_sample_count,
        "detected_key": detected_key,
        "mono_compatibility": mono_compatibility,
        "low_energy": low_energy,
        "structure": structure,
    }
