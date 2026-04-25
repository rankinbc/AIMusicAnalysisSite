"""Phase 7 — Arrangement advisor: section structure, 8-bar rule, energy contrast."""

from __future__ import annotations

import logging
from typing import Callable

logger = logging.getLogger(__name__)

# Typical EDM section labels to check for
_EDM_SECTIONS = {"intro", "drop", "breakdown", "outro"}
# Beats-per-bar assumption
_BEATS_PER_BAR = 4
# Bars must be a multiple of this
_BAR_MULTIPLE = 8


def advise(
    structure_result: dict,
    genre: str,
    progress_cb: Callable | None = None,
) -> dict:
    """Generate arrangement advice from the structural analysis in Phase 1.

    Args:
        structure_result: The ``structure`` sub-dict from Phase 1 output
                          (keys: sections, beats).
        genre:            Detected genre string.
        progress_cb:      Optional ``(phase, name, pct)`` progress callback.

    Returns:
        dict with keys: violations, fixes, section_count.
    """
    sections: list[dict] = structure_result.get("sections", [])
    # beats reserved for future time-signature analysis
    _beats: list = structure_result.get("beats", [])

    if not sections:
        return {
            "violations": [],
            "fixes": [
                "Enable Docker for structure detection (Phase 1) to unlock arrangement advice",
            ],
            "section_count": 0,
        }

    violations: list[str] = []
    fixes: list[str] = []

    # ------------------------------------------------------------------
    # 8-bar rule: each section length should be divisible by 8 bars
    # ------------------------------------------------------------------
    beats_per_bar = _BEATS_PER_BAR
    for section in sections:
        label = section.get("label", "?")
        start_beat = section.get("start_beat", 0)
        end_beat = section.get("end_beat", start_beat)
        length_beats = end_beat - start_beat
        length_bars = length_beats / beats_per_bar if beats_per_bar else 0
        if length_bars > 0 and (round(length_bars) % _BAR_MULTIPLE) != 0:
            violations.append(
                f"Section '{label}' is {length_bars:.1f} bars — not a multiple of 8"
            )
            fixes.append(
                f"Resize '{label}' to the nearest multiple of 8 bars ({round(length_bars / 8) * 8} bars)"
            )

    # ------------------------------------------------------------------
    # Energy contrast: check variation between sections
    # ------------------------------------------------------------------
    energies: list[float] = [float(s["energy"]) for s in sections if s.get("energy") is not None]
    if len(energies) >= 2:
        energy_range = max(energies) - min(energies)
        if energy_range < 0.1:
            violations.append("Low energy contrast between sections — mix sounds flat")
            fixes.append("Add a clear energy drop before the main drop for tension/release")

    # ------------------------------------------------------------------
    # Missing EDM sections check
    # ------------------------------------------------------------------
    found_labels = {s.get("label", "").lower() for s in sections}
    missing = _EDM_SECTIONS - found_labels
    if missing:
        for sect in sorted(missing):
            violations.append(f"Missing typical EDM section: '{sect}'")
            fixes.append(f"Add a '{sect}' section to complete the arrangement arc")

    logger.debug(
        "Phase 7: genre=%s sections=%d violations=%d",
        genre, len(sections), len(violations),
    )

    return {
        "violations": violations,
        "fixes": fixes,
        "section_count": len(sections),
    }
