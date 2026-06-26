"""Map measured per-genre aggregates → ``genre-profiles.json`` updates. Pure.

Sets the well-defined NUMERIC thresholds (loudness club target/range, true-peak
ceiling, crest, LRA, PLR, transient-strength floor, loudness-stability spread, BPM
window) from measured medians/percentiles and flips their ``provenance`` to
``"measured"``. The qualitative ``spectral_tilt`` / ``stereo`` hints are NOT
auto-set — their measured band/centroid/width stats are surfaced in the report for
a human to translate into the ``brightness_rank`` / emphasis hints.

Does NOT touch ``loudness.streaming`` (the -14 LUFS platform standard).
"""
from __future__ import annotations

import copy
from typing import Any

from .stats import Summary


def _set(profile: dict[str, Any], dotted: str, value: Any,
         changes: list[dict[str, Any]], genre: str) -> None:
    node = profile
    parts = dotted.split(".")
    for part in parts[:-1]:
        node = node.setdefault(part, {})
    old = node.get(parts[-1])
    node[parts[-1]] = value
    if old != value:
        changes.append({"genre": genre, "path": dotted, "old": old, "new": value})


def propose_updates(
    aggregates_by_genre: dict[str, dict[str, Summary]],
    current_profiles: dict[str, Any],
) -> dict[str, Any]:
    """Return ``{proposed, changes, report}``.

    - ``proposed`` — a deep copy of ``current_profiles`` with the measured numeric
      thresholds applied (provenance flipped to ``"measured"``).
    - ``changes`` — a flat list of ``{genre, path, old, new}`` for review.
    - ``report`` — the full measured stats per genre/metric (incl. spectral/stereo
      that are reported-not-set).
    """
    proposed = copy.deepcopy(current_profiles)
    profs: dict[str, Any] = proposed.setdefault("genre_profiles", {})
    changes: list[dict[str, Any]] = []
    report: dict[str, Any] = {}

    for genre, agg in aggregates_by_genre.items():
        prof = profs.setdefault(genre, {})
        report[genre] = {metric: s.as_dict() for metric, s in agg.items()}

        # ── loudness.club (genre's own loudness; streaming stays the platform std) ──
        if (s := agg.get("lufs")) is not None:
            _set(prof, "loudness.club.lufs_target", round(s.median, 1), changes, genre)
            _set(prof, "loudness.club.lufs_range", [round(s.p10, 1), round(s.p90, 1)], changes, genre)
            _set(prof, "loudness.club.provenance", "measured", changes, genre)
        if (s := agg.get("true_peak_db")) is not None:
            # The ceiling pro masters actually reach (the loud tail).
            _set(prof, "loudness.club.true_peak_dbtp_max", round(s.p90, 1), changes, genre)
        if (s := agg.get("st_spread")) is not None:
            # Above the 90th-percentile short-term spread of pro masters reads as unstable.
            _set(prof, "loudness.stability.short_term_over_integrated_lu", round(s.p90, 1), changes, genre)
            _set(prof, "loudness.stability.provenance", "measured", changes, genre)

        # ── dynamics ──
        if (s := agg.get("crest_factor")) is not None:
            _set(prof, "dynamics.crest_db.target", round(s.median, 1), changes, genre)
            _set(prof, "dynamics.crest_db.range", [round(s.p10, 1), round(s.p90, 1)], changes, genre)
            _set(prof, "dynamics.crest_db.warn_below", round(s.p10, 1), changes, genre)
            _set(prof, "dynamics.crest_db.provenance", "measured", changes, genre)
        if (s := agg.get("loudness_range_lu")) is not None:
            _set(prof, "dynamics.lra_lu.target", round(s.median, 1), changes, genre)
            _set(prof, "dynamics.lra_lu.range", [round(s.p10, 1), round(s.p90, 1)], changes, genre)
            _set(prof, "dynamics.lra_lu.provenance", "measured", changes, genre)
        if (s := agg.get("plr")) is not None:
            _set(prof, "dynamics.plr.warn_below", round(s.p10, 1), changes, genre)
            _set(prof, "dynamics.plr.provenance", "measured", changes, genre)
        if (s := agg.get("avg_transient_strength")) is not None:
            # Below the 10th-percentile onset strength of pro masters reads as weak.
            _set(prof, "dynamics.transient_strength.weak_below", round(s.p10, 3), changes, genre)
            _set(prof, "dynamics.transient_strength.provenance", "measured", changes, genre)

        # ── bpm window ──
        if (s := agg.get("bpm")) is not None:
            _set(prof, "bpm.min", round(s.p10), changes, genre)
            _set(prof, "bpm.max", round(s.p90), changes, genre)
            _set(prof, "bpm.center", round(s.median), changes, genre)
            _set(prof, "bpm.provenance", "measured", changes, genre)

    return {"proposed": proposed, "changes": changes, "report": report}
