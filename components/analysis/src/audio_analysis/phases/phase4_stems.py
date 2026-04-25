"""Phase 4 — Stem separation and frequency clash detection.

Two implementations are available:
  - Spectral (active): frequency-band energy analysis via librosa STFT.
    Runs in ~1-2 seconds.  No extra dependencies.
  - Demucs (disabled): true stem separation via demucs.api.Separator.
    10-20 min CPU for a 5-min track.  Re-enable by setting USE_DEMUCS = True
    once worker timeouts are configured and demucs is installed.
"""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path
from typing import Callable

import librosa
import numpy as np

from ..models import get_model

logger = logging.getLogger(__name__)

# Flip to True to re-enable demucs stem separation (requires demucs installed
# and worker soft_time_limit raised to ≥ 1800 seconds).
USE_DEMUCS = False

# Frequency bands for spectral clash detection (Hz)
_BANDS: dict[str, tuple[int, int]] = {
    "sub_bass":  (20,    60),
    "bass":      (60,   200),
    "low_mid":   (200,  500),
    "mid":       (500,  2000),
    "high_mid":  (2000, 6000),
    "presence":  (6000, 12000),
    "air":       (12000, 20000),
}


def analyze(wav_path: Path, progress_cb: Callable | None = None) -> dict:
    if USE_DEMUCS:
        return _demucs_analyze(wav_path, progress_cb)
    return _spectral_analyze(wav_path, progress_cb)


# ---------------------------------------------------------------------------
# Spectral implementation (active)
# ---------------------------------------------------------------------------

def _spectral_analyze(wav_path: Path, progress_cb: Callable | None = None) -> dict:
    if progress_cb:
        progress_cb(4, "Stem Separation & Clash", 0.1)

    y, sr = librosa.load(str(wav_path), sr=44100, mono=True)

    if progress_cb:
        progress_cb(4, "Stem Separation & Clash", 0.4)

    S = np.abs(librosa.stft(y, n_fft=4096, hop_length=512))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=4096)

    band_rms_db: dict[str, float] = {}
    for name, (f_lo, f_hi) in _BANDS.items():
        mask = (freqs >= f_lo) & (freqs < f_hi)
        if mask.any():
            rms = float(np.sqrt(np.mean(S[mask] ** 2)))
            band_rms_db[name] = float(librosa.amplitude_to_db(np.array([max(rms, 1e-10)]))[0])
        else:
            band_rms_db[name] = -80.0

    if progress_cb:
        progress_cb(4, "Stem Separation & Clash", 0.8)

    clashes: list[dict] = []

    # Low-end buildup: sub-bass and bass both elevated
    if band_rms_db["sub_bass"] > -30 and band_rms_db["bass"] > -25:
        clashes.append({
            "stems": "low-end buildup",
            "frequency_range": "sub-bass / bass (20–200 Hz)",
            "severity": "high" if band_rms_db["bass"] > -18 else "moderate",
        })

    # Mud: low-mid congestion
    if band_rms_db["low_mid"] > -22:
        clashes.append({
            "stems": "low-mid congestion",
            "frequency_range": "low-mid (200–500 Hz)",
            "severity": "high" if band_rms_db["low_mid"] > -15 else "moderate",
        })

    # Harshness: high-mid spike relative to mid
    if band_rms_db["high_mid"] > -20 and (band_rms_db["high_mid"] - band_rms_db["mid"]) > 6:
        clashes.append({
            "stems": "high-mid harshness",
            "frequency_range": "high-mid (2–6 kHz)",
            "severity": "moderate",
        })

    logger.debug("Phase 4 (spectral): bands=%s clashes=%d", band_rms_db, len(clashes))

    if progress_cb:
        progress_cb(4, "Stem Separation & Clash", 1.0)

    return {"stems": {}, "band_energy": band_rms_db, "clashes": clashes}


# ---------------------------------------------------------------------------
# Demucs implementation (disabled — USE_DEMUCS = False)
# ---------------------------------------------------------------------------

def _demucs_analyze(wav_path: Path, progress_cb: Callable | None = None) -> dict:
    model = get_model("demucs")

    if model is None:
        return {"stems": {}, "clashes": [], "error": "demucs not available"}

    stems: dict[str, dict] = {}

    with tempfile.TemporaryDirectory() as tmpdir:
        model.separate_audio_file(
            wav_path,
            shifts=1,
            overlap=0.25,
            output_dir=tmpdir,
        )

        for stem_name in ["drums", "bass", "other", "vocals"]:
            stem_files = list(Path(tmpdir).rglob(f"*{stem_name}*.wav"))
            if not stem_files:
                continue
            y_stem, _ = librosa.load(str(stem_files[0]), sr=44100)
            peak = float(librosa.amplitude_to_db(np.array([np.max(np.abs(y_stem))]))[0])
            rms_val = float(np.sqrt(np.mean(y_stem**2)))
            rms_db = float(librosa.amplitude_to_db(np.array([rms_val]))[0])
            stems[stem_name] = {"peak_db": peak, "rms_db": rms_db}

    clashes: list[dict] = []
    if "bass" in stems and "drums" in stems:
        bass_rms = stems["bass"]["rms_db"]
        drums_rms = stems["drums"]["rms_db"]
        if bass_rms > -20.0 and drums_rms > -20.0:
            clashes.append({
                "stems": "bass vs drums",
                "frequency_range": "sub-bass / bass (20-200 Hz)",
                "severity": "high" if bass_rms > -12.0 and drums_rms > -12.0 else "moderate",
            })

    logger.debug("Phase 4 (demucs): stems=%s clashes=%d", list(stems.keys()), len(clashes))

    return {"stems": stems, "clashes": clashes}
