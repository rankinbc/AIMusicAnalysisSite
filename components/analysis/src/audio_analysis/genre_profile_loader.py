"""Genre profile loader — reads statistical profiles from JSON files.

Profiles live in ``data/reference_library/profiles/`` relative to the
working directory (CWD is always the project root for API and worker).

The trance profile was built from 196 professionally mastered reference
tracks using the AbletonAIAnalysis reference profiler.  Each profile stores
per-feature statistics (mean, std, percentiles p10-p90, acceptable range)
computed over the reference collection.

Feature mapping from Phase 1 output → profile feature names:

    phase1 key          profile feature      notes
    ──────────────────  ───────────────────  ─────────────────────────────────
    bpm                 tempo                direct 1-to-1
    stereo_correlation  phase_correlation    direct 1-to-1 (Pearson −1..+1)
    (derived)           stereo_width         1 − |stereo_correlation|, 0-1 scale
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_PROFILES_DIR = Path("data/reference_library/profiles")

_PROFILE_FILENAMES: dict[str, str] = {
    "trance": "trance_profile.json",
    "house": "house_profile.json",
    "techno": "techno_profile.json",
    "dnb": "dnb_profile.json",
    "drum and bass": "dnb_profile.json",
    "drum & bass": "dnb_profile.json",
    "progressive": "progressive_profile.json",
    "progressive house": "progressive_profile.json",
    "progressive trance": "progressive_profile.json",
}


def load_profile(genre: str) -> Optional[dict]:
    """Load the raw profile JSON for *genre*.

    Returns the parsed dict (keys: ``name``, ``track_count``,
    ``feature_statistics``, ``clusters``, …) or None if not found.
    """
    key = genre.lower().strip()
    filename = _PROFILE_FILENAMES.get(key)
    if not filename:
        return None
    path = _PROFILES_DIR / filename
    if not path.exists():
        logger.debug("Genre profile not found: %s", path)
        return None
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def compute_percentile(stats: dict, value: float) -> float:
    """Interpolate what percentile *value* occupies within *stats*.

    Uses linear interpolation between stored anchor points
    (min, p10, p25, p50, p75, p90, max) — no scipy required.

    Returns a float in [0, 100].
    """
    # Injected user profiles carry only {mean, std} (no percentile anchors).
    # Synthesize Gaussian anchors so the percentile is meaningful. Disk genre
    # profiles carry explicit p10..p90, so this branch never fires for them.
    if "p50" not in stats and "mean" in stats and stats.get("std") is not None:
        mean = stats["mean"]
        std = stats["std"] or 1e-9
        anchors = [
            (mean - 3.0 * std, 0.0),
            (mean - 1.2816 * std, 10.0),
            (mean - 0.6745 * std, 25.0),
            (mean, 50.0),
            (mean + 0.6745 * std, 75.0),
            (mean + 1.2816 * std, 90.0),
            (mean + 3.0 * std, 100.0),
        ]
    else:
        anchors = [
            (stats.get("min", 0.0), 0.0),
            (stats.get("p10", 0.0), 10.0),
            (stats.get("p25", 0.0), 25.0),
            (stats.get("p50", 0.0), 50.0),
            (stats.get("p75", 0.0), 75.0),
            (stats.get("p90", 0.0), 90.0),
            (stats.get("max", 0.0), 100.0),
        ]
    if value <= anchors[0][0]:
        return 0.0
    if value >= anchors[-1][0]:
        return 100.0
    for i in range(len(anchors) - 1):
        lo_v, lo_p = anchors[i]
        hi_v, hi_p = anchors[i + 1]
        if lo_v <= value <= hi_v:
            if hi_v == lo_v:
                return lo_p
            t = (value - lo_v) / (hi_v - lo_v)
            return lo_p + t * (hi_p - lo_p)
    return 50.0


def describe_percentile(pct: float) -> str:
    """Return a plain-English phrase for a percentile value."""
    if pct >= 90:
        return "very high (top 10%)"
    if pct >= 75:
        return "above average (top 25%)"
    if pct >= 50:
        return "above median"
    if pct >= 25:
        return "below median"
    if pct >= 10:
        return "low (bottom 25%)"
    return "very low (bottom 10%)"
