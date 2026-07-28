"""Per-stem audio analysis: bands, loudness, stereo, clash matrix.

Ported from AbletonAIAnalysis: projects/music-analyzer/src/stem_analyzer.py
Same band edges, same clash thresholds.
"""
from itertools import combinations
from pathlib import Path
from typing import Any, Callable

import librosa
import numpy as np
import pyloudnorm as pyln
import soundfile as sf

try:
    from scipy.fft import next_fast_len
except ImportError:  # pragma: no cover — scipy is a librosa dependency
    def next_fast_len(n: int, real: bool = False) -> int:
        return 1 << max(0, int(n) - 1).bit_length()

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
    # dtype="float32" — the default decodes to float64 (~2x memory + a copy).
    audio, file_sr = sf.read(file_path, always_2d=True, dtype="float32")
    if file_sr != sr:
        audio = librosa.resample(audio.T, orig_sr=file_sr, target_sr=sr).T
    return audio, sr


def _shared_spectrum(mono: np.ndarray, sr: int) -> tuple[np.ndarray, np.ndarray]:
    """One windowed rfft per signal — every spectral metric derives from this.

    Band energies, band ratios, dominant frequencies and the spectral centroid
    used to each recompute the same full-track FFT; this is the single source.
    The window is cast to float32 (np.hanning is float64 and would upcast the
    whole signal), and the FFT length is padded to the next fast size —
    arbitrary sample counts fall back to Bluestein's algorithm (10-50x slower).
    Zero-padding only refines the bin grid; band sums/ratios are computed on
    the padded ``freqs`` axis, never on hardcoded bin indices.
    """
    n = len(mono)
    if n == 0:
        return np.zeros(1), np.zeros(1)
    win = np.hanning(n).astype(np.float32)
    n_fast = int(next_fast_len(n))
    spec = np.abs(np.fft.rfft(mono * win, n=n_fast))
    freqs = np.fft.rfftfreq(n_fast, d=1 / sr)
    return freqs, spec


def _band_energy_db_from_spec(
    freqs: np.ndarray, spec: np.ndarray,
) -> dict[FreqBand, float]:
    out: dict[FreqBand, float] = {}
    for band, (lo, hi) in BAND_EDGES_HZ.items():
        mask = (freqs >= lo) & (freqs < hi)
        energy = float((spec[mask] ** 2).sum())
        out[band] = 10 * float(np.log10(energy + 1e-12))
    return out


def _band_ratios_from_spec(
    freqs: np.ndarray, spec: np.ndarray,
) -> dict[FreqBand, float]:
    total = float((spec ** 2).sum() + 1e-12)
    return {
        band: float((spec[(freqs >= lo) & (freqs < hi)] ** 2).sum()) / total
        for band, (lo, hi) in BAND_EDGES_HZ.items()
    }


def _dominant_from_spec(
    freqs: np.ndarray, spec: np.ndarray, k: int = 3,
) -> list[float]:
    # argpartition, not argsort: a full argsort of ~6.6M bins to pick the top 3
    # costs about as much as the FFT itself.
    if len(spec) <= k:
        idx = np.argsort(spec)[::-1]
    else:
        idx = np.argpartition(spec, -k)[-k:]
        idx = idx[np.argsort(spec[idx])[::-1]]
    return [float(freqs[i]) for i in idx]


def _centroid_from_spec(freqs: np.ndarray, spec: np.ndarray) -> float:
    # Exact centroid of the shared magnitude spectrum. Replaces librosa's
    # framewise-STFT mean centroid — same signal, no framing; values shift
    # slightly (covered by the golden regeneration).
    total = float(spec.sum())
    if total <= 0.0:
        return 0.0
    return float((freqs * spec).sum() / total)


def _band_energy_db(mono: np.ndarray, sr: int) -> dict[FreqBand, float]:
    freqs, spec = _shared_spectrum(mono, sr)
    return _band_energy_db_from_spec(freqs, spec)


def _band_energy_ratios(mono: np.ndarray, sr: int) -> dict[FreqBand, float]:
    freqs, spec = _shared_spectrum(mono, sr)
    return _band_ratios_from_spec(freqs, spec)


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
    freqs, spec = _shared_spectrum(mono, sr)
    return _dominant_from_spec(freqs, spec, k)


def _measure_one(role: StemRole, file_path: Path, sr: int) -> StemMetrics:
    audio, sr = _load(file_path, sr)
    return _measure_from_audio(role, audio, sr)


def _measure_from_audio(role: StemRole, audio: np.ndarray, sr: int) -> StemMetrics:
    return _measure_with_ratios(role, audio, sr)[0]


def _measure_with_ratios(
    role: StemRole, audio: np.ndarray, sr: int,
) -> tuple[StemMetrics, dict[FreqBand, float]]:
    """Measure one signal, computing its spectrum exactly once.

    Returns the metrics AND the band-energy ratios (needed by the clash matrix)
    so callers never recompute the spectrum for ratios separately.
    """
    if audio.ndim == 1:
        audio = audio[:, None]
    mono = audio.mean(axis=1)
    freqs, spec = _shared_spectrum(mono, sr)
    meter = pyln.Meter(sr)
    try:
        lufs = float(meter.integrated_loudness(mono))
        # 10.7 review F4: pyloudnorm returns -inf for silent stems WITHOUT
        # raising — json.dumps('-Infinity') is invalid JSON and jsonb
        # rejects it. Same finite-guard as phase1's integrated_lufs.
        if not np.isfinite(lufs):
            lufs = -70.0
    except Exception:
        lufs = -70.0
    rms = 20 * float(np.log10(np.sqrt((mono ** 2).mean()) + 1e-12))
    peak = 20 * float(np.log10(np.max(np.abs(mono)) + 1e-12))
    width, is_mono = _stereo_width(audio)
    metrics = StemMetrics(
        role=role,
        duration_s=float(len(mono) / sr),
        peak_db=peak,
        rms_db=rms,
        lufs_integrated=lufs,
        dynamic_range_db=peak - rms,
        band_energy_db=_band_energy_db_from_spec(freqs, spec),
        spectral_centroid_hz=_centroid_from_spec(freqs, spec),
        dominant_frequencies_hz=_dominant_from_spec(freqs, spec),
        stereo_width=width,
        pan_estimate=_pan_estimate(audio),
        is_mono=is_mono,
    )
    return metrics, _band_ratios_from_spec(freqs, spec)


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
    """Sum (mix) several stems of one role into a single stereo buffer.

    Accumulates one file at a time (growing the buffer as needed) instead of
    materializing every decoded stem simultaneously — with up to 100 stems the
    all-at-once list was a real memory-pressure source. Same summation order,
    so results are identical to the old implementation.
    """
    acc: np.ndarray | None = None
    for p in paths:
        a, _ = _load(p, sr)
        if a.shape[1] == 1:
            a = np.repeat(a, 2, axis=1)
        a = a[:, :2]
        if acc is None:
            acc = np.zeros((a.shape[0], 2), dtype=np.float32)
        elif a.shape[0] > acc.shape[0]:
            grown = np.zeros((a.shape[0], 2), dtype=np.float32)
            grown[: acc.shape[0], :] = acc
            acc = grown
        acc[: a.shape[0], :] += a
    if acc is None:
        return np.zeros((1, 2), dtype=np.float32)
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
    on_progress: Callable[[int, int], None] | None = None,
) -> StemAnalysisResult:
    """Many-stems-per-role: sum each role's stems into one bus, then analyze per role.

    Reuses the role-keyed metrics + clash + balance so downstream output is identical
    in shape to analyze(). One role bus is decoded/measured at a time (spectrum
    computed once per bus, ratios returned from the same spectrum); ``on_progress``
    is called with (roles_done, roles_total) after each bus.
    """
    items = [(role, paths) for role, paths in groups.items() if paths]
    per_stem: dict[StemRole, StemMetrics] = {}
    ratios: dict[StemRole, dict[FreqBand, float]] = {}
    for i, (role, paths) in enumerate(items):
        audio = _sum_group(paths, sample_rate)
        m, r = _measure_with_ratios(role, audio, sample_rate)
        per_stem[role] = m
        ratios[role] = r
        if on_progress:
            on_progress(i + 1, len(items))
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
    on_progress: Callable[[int, int], None] | None = None,
) -> dict:
    """Per-stem mode: one metrics row per stem (labelled), with capped pairwise clash.

    stems: list of (label, role, path). Returns a JSON-safe dict (NOT StemAnalysisResult)
    because rows are keyed by stem label, not role. Each stem's spectrum is
    computed once (metrics + ratios from the same rfft).
    """
    measured: list[tuple[str, StemRole, StemMetrics, dict[FreqBand, float]]] = []
    for i, (label, role, path) in enumerate(stems):
        audio, _ = _load(path, sample_rate)
        m, ratios = _measure_with_ratios(role, audio, sample_rate)
        measured.append((label, role, m, ratios))
        if on_progress:
            on_progress(i + 1, len(stems))

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
