"""Phase 6 — Genre profile gap analysis.

Compares the track's Phase 1 features against a statistical profile built
from professional reference tracks.  Statistical profiles live in
``data/reference_library/profiles/<genre>_profile.json`` and are built with
the AbletonAIAnalysis reference profiler.

Feature mapping (Phase 1 → profile):

    phase1 key          profile feature      transform
    ──────────────────  ───────────────────  ─────────────────────────────────
    bpm                 tempo                direct
    stereo_correlation  phase_correlation    direct (Pearson −1..+1)
    stereo_correlation  stereo_width         1 − |stereo_correlation|, 0-1 scale

When no statistical profile is found for the genre the phase falls back to
comparing against the mean of any pre-computed per-track Phase 1 JSON files
stored in ``data/reference_library/<genre>/``.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Callable

import numpy as np

logger = logging.getLogger(__name__)

_REFERENCE_LIBRARY = Path("data/reference_library")


# ---------------------------------------------------------------------------
# Feature vector helpers (used by fallback path only)
# ---------------------------------------------------------------------------

def _build_feature_vector(phase1: dict) -> list[float]:
    bands = phase1.get("bands", {})
    band_order = ["sub_bass", "bass", "low_mid", "mid", "upper_mid", "presence", "air"]
    return [
        phase1.get("lufs", -70.0),
        phase1.get("rms", 0.0),
        phase1.get("bpm", 120.0),
        phase1.get("stereo_width", 0.0),
        *(bands.get(b, -40.0) for b in band_order),
    ]


_FEATURE_NAMES = [
    "lufs", "rms", "bpm", "stereo_width",
    "band_sub_bass", "band_bass", "band_low_mid", "band_mid",
    "band_upper_mid", "band_presence", "band_air",
]


# ---------------------------------------------------------------------------
# Profile-based analysis (primary path)
# ---------------------------------------------------------------------------

def _analyze_with_profile(
    profile: dict,
    phase1_result: dict,
) -> dict:
    """Compute percentile-based gaps using the statistical profile."""
    from ..genre_profile_loader import compute_percentile, describe_percentile

    feature_stats: dict[str, dict] = profile.get("feature_statistics", {})
    track_count: int = profile.get("track_count", 0)

    gaps: dict[str, dict] = {}
    percentile_scores: list[float] = []

    def _add_gap(gap_key: str, profile_feat: str, user_val: float) -> None:
        if profile_feat not in feature_stats:
            return
        stats = feature_stats[profile_feat]
        pct = compute_percentile(stats, user_val)
        percentile_scores.append(pct)
        # Injected user profiles carry only {mean, std} — derive the acceptable
        # band as mean ± 2·std. Disk genre profiles already carry an explicit
        # acceptable_range (and p10/p90), so this fallback never fires for them.
        acc_range = stats.get("acceptable_range")
        if acc_range is None or acc_range[0] is None or acc_range[1] is None:
            mean, std = stats.get("mean"), stats.get("std")
            if mean is not None and std is not None:
                acc_range = [mean - 2 * std, mean + 2 * std]
            else:
                acc_range = [stats.get("p10"), stats.get("p90")]
        gaps[gap_key] = {
            "user_val": round(user_val, 4),
            "genre_mean": round(stats.get("mean", 0.0), 4),
            "genre_std": round(stats.get("std", 0.0), 4),
            "acceptable_range": [round(acc_range[0], 4), round(acc_range[1], 4)],
            "delta": round(user_val - stats.get("mean", 0.0), 4),
            "percentile": round(pct, 1),
            "description": describe_percentile(pct),
            "in_range": acc_range[0] <= user_val <= acc_range[1],
        }

    # BPM → tempo
    _add_gap("bpm", "tempo", phase1_result.get("bpm", 120.0))

    # stereo_correlation → phase_correlation
    corr = phase1_result.get("stereo_correlation", 1.0)
    _add_gap("stereo_correlation", "phase_correlation", corr)

    # stereo_width proxy: 1 − |corr| maps to profile's stereo_width (0-1)
    width_proxy = float(1.0 - abs(corr))
    _add_gap("stereo_width", "stereo_width", width_proxy)

    overall_percentile = float(np.mean(percentile_scores)) if percentile_scores else 50.0

    return {
        "genre": profile.get("name", "unknown").replace("_profile", ""),
        "percentile": round(overall_percentile, 1),
        "profile_source": f"{profile.get('name', 'unknown')} ({track_count} tracks)",
        "gaps": gaps,
    }


# ---------------------------------------------------------------------------
# Fallback: per-track JSON approach (old behaviour)
# ---------------------------------------------------------------------------

def _analyze_with_per_track_files(
    genre: str,
    genre_dir: Path,
    phase1_result: dict,
) -> dict:
    """Original logic: compare against mean of pre-computed per-track Phase 1 JSONs."""
    from scipy.stats import percentileofscore  # type: ignore[import]

    ref_profiles: list[list[float]] = []
    for json_file in genre_dir.glob("*.json"):
        try:
            with open(json_file) as fh:
                profile = json.load(fh)
            ref_profiles.append(_build_feature_vector(profile))
        except Exception:
            logger.warning("Could not load reference profile: %s", json_file)

    if not ref_profiles:
        return {"genre": genre, "percentile": 50.0, "gaps": {}}

    ref_array = np.array(ref_profiles)
    user_vec = np.array(_build_feature_vector(phase1_result))

    lufs_scores = ref_array[:, 0]
    percentile = float(percentileofscore(lufs_scores, user_vec[0], kind="rank"))

    ref_means = ref_array.mean(axis=0)
    gaps: dict[str, dict] = {}
    for i, feat_name in enumerate(_FEATURE_NAMES):
        delta = float(user_vec[i] - ref_means[i])
        gaps[feat_name] = {
            "user_val": float(user_vec[i]),
            "genre_mean": float(ref_means[i]),
            "delta": delta,
        }

    return {"genre": genre, "percentile": percentile, "gaps": gaps}


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def analyze(
    wav_path: Path,
    genre: str,
    phase1_result: dict,
    progress_cb: Callable | None = None,
    reference_profile: dict | None = None,
) -> dict:
    """Compare the track's features against a reference profile.

    Args:
        wav_path:          Path to the 44100 Hz WAV (available for future use).
        genre:             Detected genre string from Phase 2.
        phase1_result:     Phase 1 output for the uploaded track.
        progress_cb:       Optional ``(phase, name, pct)`` progress callback.
        reference_profile: Optional override (the BFF-resolved profile). A user
            profile (``{"kind":"user","feature_statistics":…}``) bypasses the disk
            load; a genre override (``{"kind":"genre","genre":…}``) forces that
            genre's disk profile. ``None`` ⇒ the unchanged detected-genre path.

    Returns:
        dict with keys: genre, percentile, gaps (and profile_source when a
        statistical profile was used). When an override is supplied, also
        ``profile_kind`` / ``profile_name`` / ``profile_hue`` for the UI. The
        ``None`` path output is unchanged (golden-snapshot stable).
    """
    from ..genre_profile_loader import load_profile

    # ── Override: injected user profile — bypasses the disk load entirely. ──
    if (
        reference_profile is not None
        and reference_profile.get("kind") == "user"
        and reference_profile.get("feature_statistics")
    ):
        result = _analyze_with_profile(reference_profile, phase1_result)
        result["profile_kind"] = "user"
        result["profile_name"] = reference_profile.get("name")
        result["profile_hue"] = reference_profile.get("hue")
        return result

    # ── Override: genre preset — force a specific genre's disk profile. ──
    override_genre: str | None = None
    if reference_profile is not None and reference_profile.get("kind") == "genre":
        override_genre = reference_profile.get("genre")
    effective_genre = override_genre or genre

    # Primary path: statistical profile JSON
    profile = load_profile(effective_genre)
    if profile is not None:
        logger.debug(
            "Phase 6: using statistical profile for genre=%s (%d tracks)",
            effective_genre,
            profile.get("track_count", 0),
        )
        result = _analyze_with_profile(profile, phase1_result)
    else:
        # Fallback: per-track phase1 JSON files in the reference library
        genre_dir = _REFERENCE_LIBRARY / effective_genre
        if not genre_dir.exists():
            logger.info("Phase 6: no profile or reference library for genre=%s", effective_genre)
            result = {"genre": effective_genre, "percentile": 50.0, "gaps": {}}
        else:
            logger.debug("Phase 6: falling back to per-track files for genre=%s", effective_genre)
            result = _analyze_with_per_track_files(effective_genre, genre_dir, phase1_result)

    # Label ONLY when this was an explicit override — the plain detected-genre
    # path (reference_profile is None) stays byte-identical for the golden snapshot.
    if override_genre is not None:
        result["profile_kind"] = "genre"
        result["profile_name"] = override_genre
        result["profile_hue"] = None
    return result
