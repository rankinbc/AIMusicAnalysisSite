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

# Krumhansl-Schmuckler key profiles — used to score how strongly a track's mean
# chromagram fits ANY major/minor key. The max correlation across all 24
# rotations is a well-calibrated tonal-clarity confidence (clear tonal material
# ≈ 0.7–0.9; ambiguous/modal/atonal < 0.5), which the
# `key_detection_low_confidence` rule thresholds at 0.5.
_KRUMHANSL_MAJOR = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)
_KRUMHANSL_MINOR = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
)


def _key_detection_confidence(chroma_mean: np.ndarray) -> float:
    """Max Pearson correlation of the chromagram against all 24 Krumhansl key
    profiles — a 0–1 tonal-clarity score (higher = a clearer single key)."""
    profiles = [np.roll(_KRUMHANSL_MAJOR, i) for i in range(12)]
    profiles += [np.roll(_KRUMHANSL_MINOR, i) for i in range(12)]
    best = 0.0
    cm = chroma_mean.astype(float)
    if float(np.std(cm)) < 1e-9:  # flat chroma → no tonal centre
        return 0.0
    for prof in profiles:
        corr = float(np.corrcoef(cm, prof)[0, 1])
        if np.isfinite(corr) and corr > best:
            best = corr
    return float(np.clip(best, 0.0, 1.0))


def _key_estimate(chroma_mean: np.ndarray) -> dict:
    """Full 24-key Krumhansl readout (B4 lift) — surfaces the correlation vector
    the confidence calc already computes internally and throws away.

    `key` is the chroma-argmax pitch class (identical to ``detected_key``) and
    `confidence` matches ``key_detection_confidence`` by construction, so the
    two existing fields never diverge from this richer estimate. Adds `mode`
    (major/minor at that key), the second-best key/mode, and the raw 24
    correlations (12 major rotations C..B, then 12 minor rotations C..B) — the
    inputs the `modal_ambiguity` rule needs. All values are JSON-safe floats.
    """
    cm = chroma_mean.astype(float)
    key_idx = int(np.argmax(cm))
    if float(np.std(cm)) < 1e-9:  # flat chroma → no tonal centre
        return {
            "key": _KEY_NAMES[key_idx],
            "mode": "major",
            "confidence": 0.0,
            "second_key": _KEY_NAMES[key_idx],
            "second_mode": "minor",
            "profile_corrs": [0.0] * 24,
        }
    profiles = [np.roll(_KRUMHANSL_MAJOR, i) for i in range(12)]
    profiles += [np.roll(_KRUMHANSL_MINOR, i) for i in range(12)]
    corrs: list[float] = []
    for prof in profiles:
        c = float(np.corrcoef(cm, prof)[0, 1])
        corrs.append(c if np.isfinite(c) else 0.0)
    mode = "major" if corrs[key_idx] >= corrs[key_idx + 12] else "minor"
    confidence = float(np.clip(max(corrs), 0.0, 1.0))
    second_idx = int(np.argsort(np.asarray(corrs))[::-1][1])
    return {
        "key": _KEY_NAMES[key_idx],
        "mode": mode,
        "confidence": confidence,
        "second_key": _KEY_NAMES[second_idx % 12],
        "second_mode": "major" if second_idx < 12 else "minor",
        "profile_corrs": corrs,
    }

# Reasons we've already logged for unavailable structure detection, so a run of
# N tracks against a host with no Docker image logs the cause once, not N times.
_logged_structure_reasons: set[str] = set()

# Emitted by Phase 1 when structure detection is deferred to a background job
# (the worker runs the ~60-90 s allin1 step off the critical path). The
# ``deferred`` flag lets the UI show "analyzing arrangement…" rather than the
# "not assessed" state used for a genuinely-unavailable detector.
_DEFERRED_STRUCTURE = {
    "available": False,
    "deferred": True,
    "reason": "Structure detection running in the background",
    "segments": [],
    "beats": [],
}


def _log_structure_unavailable_once(reason: str) -> None:
    if reason not in _logged_structure_reasons:
        _logged_structure_reasons.add(reason)
        logger.warning("Structure detection unavailable: %s", reason)


def _windowed_loudness(
    y: np.ndarray, sr: int, integrated_lufs: float
) -> tuple[float, float, float, dict]:
    """EBU R128 momentary (0.4 s) / short-term (3 s) max loudness + loudness range
    + the time-aligned loudness timeline (B1 lift).

    Returns ``(loudness_range_lu, short_term_max_lufs, momentary_max_lufs,
    timeline)`` in LU / LUFS. ``timeline`` is
    ``{"momentary": {"t": [s…], "lufs": […]}, "short_term": {…}}`` — the per-window
    series this used to compute and discard, now surfaced (the inputs the
    sidechain/pumping rules need). Each window class is measured with its own
    ``pyloudnorm.Meter`` whose gating block == the window. Robust to short clips
    (empty series, integrated value, 0.0 LRA) and bounded on long tracks (window
    count capped, so the series stays small enough for JSONB).
    """
    data = y.T.astype(float)  # (samples, channels) for pyloudnorm
    n = data.shape[0]

    def _series(win_s: float, max_windows: int) -> list[tuple[float, float]]:
        win = int(win_s * sr)
        if win <= 0 or n < win:
            return []
        # Stride so we evaluate at most ``max_windows`` windows regardless of
        # track length; never finer than 25% of the window.
        hop = max(int(0.25 * win), (n - win) // max_windows + 1)
        meter = pyloudnorm.Meter(sr, block_size=win_s)
        out: list[tuple[float, float]] = []
        for start in range(0, n - win + 1, hop):
            try:
                loud = float(meter.integrated_loudness(data[start : start + win]))
            except Exception:  # noqa: BLE001 — silent/too-short window; skip it
                continue
            if np.isfinite(loud):
                out.append((float(start / sr), loud))
        return out

    momentary = _series(0.4, 300)
    short_term = _series(3.0, 150)
    momentary_vals = [v for _, v in momentary]
    short_term_vals = [v for _, v in short_term]
    momentary_max = max(momentary_vals) if momentary_vals else integrated_lufs
    short_term_max = max(short_term_vals) if short_term_vals else integrated_lufs

    # EBU R128 loudness range: P95 − P10 of the gated short-term distribution.
    lra = 0.0
    if len(short_term_vals) >= 2:
        st = np.asarray(short_term_vals)
        st = st[st > -70.0]  # absolute gate
        if st.size:
            gated = st[st > (st.mean() - 20.0)]  # relative gate
            base = gated if gated.size else st
            lra = float(np.percentile(base, 95) - np.percentile(base, 10))

    timeline = {
        "momentary": {
            "t": [t for t, _ in momentary],
            "lufs": momentary_vals,
        },
        "short_term": {
            "t": [t for t, _ in short_term],
            "lufs": short_term_vals,
        },
    }

    return lra, float(short_term_max), float(momentary_max), timeline


def _detect_structure(wav_path: Path) -> dict:
    """Run allin1 structure detection in Docker and shape the result.

    Returns a dict the Phase-7 adapter consumes. On the happy path::

        {"available": True, "detection_method": "allin1-docker",
         "bpm": ..., "beats": [...], "downbeats": [...],
         "segments": [{"label", "start", "end"}, ...]}   # seconds

    When Docker / the image isn't set up, or analysis errors, returns
    ``{"available": False, "reason": "...", "segments": [], "beats": []}`` —
    the *cause* is recorded so downstream phases can say "not assessed" rather
    than punishing the track. The not-installed cause is logged once per run.
    """
    # Imported lazily: the analyzer wrapper is stdlib-only, but keeping the
    # import here mirrors the optional nature of structure detection.
    from audio_analysis.structure.docker_allin1 import (
        Allin1Unavailable,
        DockerAllin1,
    )

    from audio_analysis.structure.docker_allin1 import structure_dict_from_result

    try:
        result = DockerAllin1().analyze(wav_path)
    except Allin1Unavailable as exc:
        # Expected when the host hasn't built the image / Docker is down.
        _log_structure_unavailable_once(str(exc))
        return {"available": False, "reason": str(exc), "segments": [], "beats": []}
    except Exception as exc:  # noqa: BLE001 — analysis ran but failed; don't crash phase 1
        reason = f"allin1 analysis error: {exc}"
        logger.warning("Structure detection failed for %s: %s", wav_path.name, exc)
        return {"available": False, "reason": reason, "segments": [], "beats": []}

    return structure_dict_from_result(result)


def analyze(
    wav_path: Path,
    progress_cb: Callable | None = None,
    *,
    defer_structure: bool = False,
) -> dict:
    """Run phase-1 universal analysis on *wav_path*.

    Args:
        wav_path:    Path to a 44100 Hz WAV file.
        progress_cb: Optional ``(phase, name, pct)`` progress callback.

    Returns:
        dict with keys: lufs, rms, bpm, duration_seconds, bands, stereo_correlation,
        stereo_width, true_peak_db, peak_dbfs, clipping_detected, clipped_sample_count,
        detected_key, key_detection_confidence, mono_compatibility, low_energy,
        crest_factor, spectral_centroid_hz, spectral_contrast, spectral_flatness,
        loudness_range_lu, short_term_max_lufs, momentary_max_lufs, transients
        (avg_transient_strength / transient_count / transients_per_second), structure.
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

    # Key-detection confidence — Krumhansl key-profile fit (0 = ambiguous/modal/
    # atonal, →1 = one key clearly dominant).
    key_detection_confidence = _key_detection_confidence(chroma_mean)

    # Full 24-key Krumhansl readout (B4 lift) — key/mode + second-best + the raw
    # correlation vector. key/confidence match the two fields above by construction.
    key_estimate = _key_estimate(chroma_mean)

    # ------------------------------------------------------------------
    # Crest factor (dB) — peak-to-RMS. NOTE: `rms` above is LINEAR amplitude,
    # so convert it to dBFS before subtracting from the already-dB peak.
    # ------------------------------------------------------------------
    rms_dbfs = float(20.0 * np.log10(rms + 1e-9))
    crest_factor = float(peak_dbfs - rms_dbfs)

    # ------------------------------------------------------------------
    # Spectral descriptors — brightness (centroid), clarity (contrast/flatness)
    # ------------------------------------------------------------------
    spectral_centroid_hz = float(np.mean(librosa.feature.spectral_centroid(y=mono, sr=sr)))
    spectral_contrast = float(np.mean(librosa.feature.spectral_contrast(y=mono, sr=sr)))
    spectral_flatness = float(np.mean(librosa.feature.spectral_flatness(y=mono)))

    # ------------------------------------------------------------------
    # Transients — onset envelope (punch / attack density)
    # ------------------------------------------------------------------
    onset_env = librosa.onset.onset_strength(y=mono, sr=sr)
    onsets = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr)
    transients = {
        "avg_transient_strength": float(np.mean(onset_env)) if onset_env.size else 0.0,
        "transient_count": int(len(onsets)),
        "transients_per_second": (
            float(len(onsets) / duration_seconds) if duration_seconds > 0 else 0.0
        ),
    }

    # ------------------------------------------------------------------
    # Windowed loudness — momentary / short-term maxima + EBU R128 loudness range
    # ------------------------------------------------------------------
    loudness_range_lu, short_term_max_lufs, momentary_max_lufs, loudness_timeline = (
        _windowed_loudness(y, sr, lufs)
    )

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
    # Structure via allin1 (optional; runs in the `allin1:latest` Docker
    # container — see docker/allin1/. The worker host needs Docker running
    # and the image built; otherwise structure detection is reported as
    # unavailable rather than as a per-track failure.)
    #
    # When `defer_structure` is set the ~60-90 s allin1 step is skipped here and
    # run later by a background job (see detect_structure_and_rescore), keeping
    # the main pipeline off the critical path.
    # ------------------------------------------------------------------
    structure = dict(_DEFERRED_STRUCTURE) if defer_structure else _detect_structure(wav_path)

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
        "key_detection_confidence": key_detection_confidence,
        "key_estimate": key_estimate,
        "mono_compatibility": mono_compatibility,
        "low_energy": low_energy,
        "crest_factor": crest_factor,
        "spectral_centroid_hz": spectral_centroid_hz,
        "spectral_contrast": spectral_contrast,
        "spectral_flatness": spectral_flatness,
        "loudness_range_lu": loudness_range_lu,
        "short_term_max_lufs": short_term_max_lufs,
        "momentary_max_lufs": momentary_max_lufs,
        "loudness_timeline": loudness_timeline,
        "transients": transients,
        "structure": structure,
    }
