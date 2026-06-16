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
    return _measure_from_audio(role, audio, sr)


def _measure_from_audio(role: StemRole, audio: np.ndarray, sr: int) -> StemMetrics:
    if audio.ndim == 1:
        audio = audio[:, None]
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
    """Analyze each stem and produce a per-stem + cross-stem result.

    One file per role (legacy shape). For many-stems-per-role use analyze_grouped.
    """
    per_stem = {role: _measure_one(role, p, sample_rate) for role, p in stem_paths.items()}
    return StemAnalysisResult(
        per_stem=per_stem,
        clash_matrix=_build_clash_matrix(stem_paths, sample_rate),
        balance_flags=_balance_flags(per_stem, genre_profile),
    )


def metrics_to_dict(m: StemMetrics) -> dict:
    """JSON-safe serialization of a StemMetrics (shared by phase4 + per-stem mode)."""
    return {
        "duration_s": m.duration_s,
        "peak_db": m.peak_db,
        "rms_db": m.rms_db,
        "lufs_integrated": m.lufs_integrated,
        "dynamic_range_db": m.dynamic_range_db,
        "band_energy_db": {b.value: v for b, v in m.band_energy_db.items()},
        "spectral_centroid_hz": m.spectral_centroid_hz,
        "dominant_frequencies_hz": m.dominant_frequencies_hz,
        "stereo_width": m.stereo_width,
        "pan_estimate": m.pan_estimate,
        "is_mono": m.is_mono,
    }


def _sum_group(paths: list[Path], sr: int) -> np.ndarray:
    """Sum (mix) several stems of one role into a single stereo buffer."""
    arrs: list[np.ndarray] = []
    for p in paths:
        a, _ = _load(p, sr)
        if a.shape[1] == 1:
            a = np.repeat(a, 2, axis=1)
        arrs.append(a)
    if not arrs:
        return np.zeros((1, 2), dtype=np.float32)
    maxlen = max(a.shape[0] for a in arrs)
    acc = np.zeros((maxlen, 2), dtype=np.float32)
    for a in arrs:
        acc[: a.shape[0], :] += a[:, :2]
    return acc


def _build_clash_from_ratios(
    ratios: dict[StemRole, dict[FreqBand, float]],
) -> list[StemClash]:
    out: list[StemClash] = []
    for (role_a, ra), (role_b, rb) in combinations(ratios.items(), 2):
        for band in FreqBand:
            overlap = _clash_overlap(ra, rb, band)
            if overlap >= CLASH_THRESHOLDS["info"]:
                out.append(StemClash(
                    stem_a=role_a, stem_b=role_b, band=band,
                    overlap_severity=overlap, severity_tier=_severity_for_overlap(overlap),
                ))
    return out


def analyze_grouped(
    groups: dict[StemRole, list[Path]],
    genre_profile: Any | None = None,
    sample_rate: int = 44100,
) -> StemAnalysisResult:
    """Many-stems-per-role: sum each role's stems into one bus, then analyze per role.

    Reuses the role-keyed metrics + clash + balance so downstream output is identical
    in shape to analyze().
    """
    role_audio = {
        role: _sum_group(paths, sample_rate)
        for role, paths in groups.items() if paths
    }
    per_stem = {role: _measure_from_audio(role, audio, sample_rate) for role, audio in role_audio.items()}
    ratios = {role: _band_energy_ratios(audio.mean(axis=1), sample_rate) for role, audio in role_audio.items()}
    return StemAnalysisResult(
        per_stem=per_stem,
        clash_matrix=_build_clash_from_ratios(ratios),
        balance_flags=_balance_flags(per_stem, genre_profile),
    )


# Cap pairwise clash work in per-stem mode (N*(N-1)/2 grows fast).
MAX_CLASH_PAIRS = 600


def analyze_per_stem(
    stems: list[tuple[str, StemRole, Path]],
    genre_profile: Any | None = None,
    sample_rate: int = 44100,
    max_pairs: int = MAX_CLASH_PAIRS,
) -> dict:
    """Per-stem mode: one metrics row per stem (labelled), with capped pairwise clash.

    stems: list of (label, role, path). Returns a JSON-safe dict (NOT StemAnalysisResult)
    because rows are keyed by stem label, not role.
    """
    measured: list[tuple[str, StemRole, StemMetrics, dict[FreqBand, float]]] = []
    for label, role, path in stems:
        audio, _ = _load(path, sample_rate)
        m = _measure_from_audio(role, audio, sample_rate)
        ratios = _band_energy_ratios(audio.mean(axis=1), sample_rate)
        measured.append((label, role, m, ratios))

    per_stem_list = [
        {"id": label, "role": role.value, **metrics_to_dict(m)}
        for label, role, m, _ in measured
    ]

    # Cap clash: keep the loudest k stems where k*(k-1)/2 <= max_pairs.
    order = sorted(range(len(measured)), key=lambda i: measured[i][2].rms_db, reverse=True)
    k = len(measured)
    while k > 2 and k * (k - 1) // 2 > max_pairs:
        k -= 1
    keep = set(order[:k])
    truncated = k < len(measured)

    clash: list[dict] = []
    sub = [measured[i] for i in range(len(measured)) if i in keep]
    for (la, ra, _ma, rra), (lb, rb, _mb, rrb) in combinations(sub, 2):
        for band in FreqBand:
            overlap = _clash_overlap(rra, rrb, band)
            if overlap >= CLASH_THRESHOLDS["info"]:
                clash.append({
                    "stem_a": la, "stem_b": lb,
                    "role_a": ra.value, "role_b": rb.value,
                    "band": band.value, "overlap_severity": overlap,
                    "severity_tier": _severity_for_overlap(overlap),
                })
    return {
        "per_stem_list": per_stem_list,
        "clash_matrix": clash,
        "truncated": truncated,
        "stem_count": len(measured),
    }
