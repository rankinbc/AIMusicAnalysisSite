"""Phase 6 — Genre profile gap analysis vs curated reference library."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Callable

logger = logging.getLogger(__name__)

# Path relative to repository root; resolved at runtime
_REFERENCE_LIBRARY = Path("data/reference_library")


def _build_feature_vector(phase1: dict) -> list[float]:
    """Extract a flat numeric feature vector from a Phase 1 result."""
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


def analyze(
    wav_path: Path,
    genre: str,
    phase1_result: dict,
    progress_cb: Callable | None = None,
) -> dict:
    """Compare the track's features against the reference library for *genre*.

    Args:
        wav_path:      Path to the 44100 Hz WAV (available for future use).
        genre:         Detected genre string.
        phase1_result: Phase 1 output for the uploaded track.
        progress_cb:   Optional ``(phase, name, pct)`` progress callback.

    Returns:
        dict with keys: genre, percentile, gaps.
        Returns ``{"genre": genre, "percentile": 50.0, "gaps": {}}`` when
        the reference library directory for *genre* does not exist.
    """
    from scipy.stats import percentileofscore  # type: ignore[import]

    genre_dir = _REFERENCE_LIBRARY / genre
    if not genre_dir.exists():
        logger.info("Phase 6: no reference library for genre=%s; skipping gap analysis", genre)
        return {"genre": genre, "percentile": 50.0, "gaps": {}}

    # Load reference profiles from JSON files
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

    import numpy as np

    ref_array = np.array(ref_profiles)  # (n_refs, n_features)
    user_vec = np.array(_build_feature_vector(phase1_result))

    # Overall percentile: use LUFS (index 0) as the primary ranking feature
    lufs_scores = ref_array[:, 0]
    user_lufs = user_vec[0]
    percentile = float(percentileofscore(lufs_scores, user_lufs, kind="rank"))

    # Per-feature gap analysis
    gaps: dict[str, dict] = {}
    ref_means = ref_array.mean(axis=0)
    for i, feat_name in enumerate(_FEATURE_NAMES):
        delta = float(user_vec[i] - ref_means[i])
        gaps[feat_name] = {
            "user_val": float(user_vec[i]),
            "genre_mean": float(ref_means[i]),
            "delta": delta,
        }

    logger.debug("Phase 6: genre=%s percentile=%.1f", genre, percentile)

    return {"genre": genre, "percentile": percentile, "gaps": gaps}
