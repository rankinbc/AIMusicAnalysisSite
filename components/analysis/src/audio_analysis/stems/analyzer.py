"""Per-stem audio analysis: bands, loudness, stereo, clash matrix.

Ported from AbletonAIAnalysis: projects/music-analyzer/src/stem_analyzer.py
Same band edges, same clash thresholds.
"""
from itertools import combinations
from pathlib import Path
from typing import Any

import librosa
import numpy as np
import pyloudnorm as pyln
import soundfile as sf

from .types import (
    BAND_EDGES_HZ, BalanceFlag, FreqBand, SeverityTier, StemAnalysisResult,
    StemClash, StemMetrics, StemRole,
)


CLASH_THRESHOLDS: dict[str, float] = {"info": 0.3, "warning": 0.5, "critical": 0.7}


def _severity_for_overlap(overlap: float) -> SeverityTier:
    if overlap >= CLASH_THRESHOLDS["critical"]:
        return "critical"
    if overlap >= CLASH_THRESHOLDS["warning"]:
        return "warning"
    return "info"


def _load(file_path: Path, sr: int) -> tuple[np.ndarray, int]:
    audio, file_sr = sf.read(file_path, always_2d=True)
    audio = audio.astype(np.float32)
    if file_sr != sr:
        audio = librosa.resample(audio.T, orig_sr=file_sr, target_sr=sr).T
    return audio, sr


def _band_energy_db(mono: np.ndarray, sr: int) -> dict[FreqBand, float]:
    spec = np.abs(np.fft.rfft(mono * np.hanning(len(mono))))
    freqs = np.fft.rfftfreq(len(mono), d=1 / sr)
    out: dict[FreqBand, float] = {}
    for band, (lo, hi) in BAND_EDGES_HZ.items():
        mask = (freqs >= lo) & (freqs < hi)
        energy = float((spec[mask] ** 2).sum())
        out[band] = 10 * float(np.log10(energy + 1e-12))
    return out


def _band_energy_ratios(mono: np.ndarray, sr: int) -> dict[FreqBand, float]:
    spec = np.abs(np.fft.rfft(mono * np.hanning(len(mono))))
    freqs = np.fft.rfftfreq(len(mono), d=1 / sr)
    total = float((spec ** 2).sum() + 1e-12)
    return {
        band: float((spec[(freqs >= lo) & (freqs < hi)] ** 2).sum()) / total
        for band, (lo, hi) in BAND_EDGES_HZ.items()
    }


def _stereo_width(audio: np.ndarray) -> tuple[float, bool]:
    if audio.shape[1] == 1:
        return 0.0, True
    left, right = audio[:, 0], audio[:, 1]
    if np.allclose(left, right, atol=1e-6):
        return 0.0, True
    side = (left - right) / 2
    mid = (left + right) / 2
    side_rms = float(np.sqrt((side ** 2).mean() + 1e-12))
    mid_rms = float(np.sqrt((mid ** 2).mean() + 1e-12))
    width = min(1.0, side_rms / mid_rms) if mid_rms > 0 else 0.0
    return width, False


def _pan_estimate(audio: np.ndarray) -> float:
    if audio.shape[1] == 1:
        return 0.0
    l_rms = float(np.sqrt((audio[:, 0] ** 2).mean() + 1e-12))
    r_rms = float(np.sqrt((audio[:, 1] ** 2).mean() + 1e-12))
    total = l_rms + r_rms
    if total < 1e-9:
        return 0.0
    return float((r_rms - l_rms) / total)


def _dominant_freqs(mono: np.ndarray, sr: int, k: int = 3) -> list[float]:
    spec = np.abs(np.fft.rfft(mono * np.hanning(len(mono))))
    freqs = np.fft.rfftfreq(len(mono), d=1 / sr)
    top = np.argsort(spec)[-k:][::-1]
    return [float(freqs[i]) for i in top]


def _measure_one(role: StemRole, file_path: Path, sr: int) -> StemMetrics:
    audio, sr = _load(file_path, sr)
    mono = audio.mean(axis=1)
    meter = pyln.Meter(sr)
    try:
        lufs = float(meter.integrated_loudness(mono))
    except Exception:
        lufs = float("-inf")
    rms = 20 * float(np.log10(np.sqrt((mono ** 2).mean()) + 1e-12))
    peak = 20 * float(np.log10(np.max(np.abs(mono)) + 1e-12))
    width, is_mono = _stereo_width(audio)
    return StemMetrics(
        role=role,
        duration_s=float(len(mono) / sr),
        peak_db=peak,
        rms_db=rms,
        lufs_integrated=lufs,
        dynamic_range_db=peak - rms,
        band_energy_db=_band_energy_db(mono, sr),
        spectral_centroid_hz=float(librosa.feature.spectral_centroid(y=mono, sr=sr).mean()),
        dominant_frequencies_hz=_dominant_freqs(mono, sr),
        stereo_width=width,
        pan_estimate=_pan_estimate(audio),
        is_mono=is_mono,
    )


def _clash_overlap(a: dict[FreqBand, float], b: dict[FreqBand, float], band: FreqBand) -> float:
    return float(np.sqrt(a[band] * b[band]))


def _build_clash_matrix(
    stem_paths: dict[StemRole, Path], sr: int,
) -> list[StemClash]:
    ratios = {
        role: _band_energy_ratios(_load(p, sr)[0].mean(axis=1), sr)
        for role, p in stem_paths.items()
    }
    out: list[StemClash] = []
    for (role_a, ra), (role_b, rb) in combinations(ratios.items(), 2):
        for band in FreqBand:
            overlap = _clash_overlap(ra, rb, band)
            if overlap >= CLASH_THRESHOLDS["info"]:
                out.append(
                    StemClash(
                        stem_a=role_a, stem_b=role_b, band=band,
                        overlap_severity=overlap,
                        severity_tier=_severity_for_overlap(overlap),
                    )
                )
    return out


def _balance_flags(
    metrics: dict[StemRole, StemMetrics], genre_profile: Any | None,
) -> list[BalanceFlag]:
    if genre_profile is None:
        return []
    out: list[BalanceFlag] = []
    expectations = getattr(genre_profile, "stem_rms_db_expectations", {})
    for role, m in metrics.items():
        rng = expectations.get(role)
        if rng is None:
            continue
        lo, hi = rng
        if m.rms_db < lo:
            out.append(BalanceFlag(role, "rms_db", m.rms_db, (lo, hi), "too_low", "warning"))
        elif m.rms_db > hi:
            out.append(BalanceFlag(role, "rms_db", m.rms_db, (lo, hi), "too_high", "warning"))
    return out


def analyze(
    stem_paths: dict[StemRole, Path],
    genre_profile: Any | None = None,
    sample_rate: int = 44100,
) -> StemAnalysisResult:
    """Analyze each stem and produce a per-stem + cross-stem result."""
    per_stem = {role: _measure_one(role, p, sample_rate) for role, p in stem_paths.items()}
    return StemAnalysisResult(
        per_stem=per_stem,
        clash_matrix=_build_clash_matrix(stem_paths, sample_rate),
        balance_flags=_balance_flags(per_stem, genre_profile),
    )
