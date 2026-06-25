"""Phase 7 — Arrangement scoring using ArrangementScorer."""
from __future__ import annotations

import logging
from typing import Callable

from audio_analysis.structure.phase1_adapter import adapt
from audio_analysis.structure.arrangement_scorer import ArrangementScorer

logger = logging.getLogger(__name__)


def advise(
    structure_result: dict,
    genre: str,
    progress_cb: Callable | None = None,
    *,
    bpm: float = 128.0,
    duration_seconds: float = 0.0,
) -> dict:
    """Score arrangement using ``ArrangementScorer``.

    Args:
        structure_result: The ``structure`` sub-dict from Phase 1 output
                          (keys: sections, beats).
        genre:            Detected genre string (currently informational only).
        progress_cb:      Optional ``(phase, name, pct)`` progress callback.
        bpm:              Tempo from Phase 1 — required for time/bar conversion.
        duration_seconds: Track duration from Phase 1.

    Returns:
        Dict containing the full ArrangementScore (overall_score, grade,
        component scores, section_scores, issues, suggestions, metadata).
        Backward-compatible ``fixes`` and ``violations`` keys are also
        included for older consumers.
    """
    structure = adapt(structure_result, bpm, duration_seconds)
    scorer = ArrangementScorer()
    score = scorer.score(structure)
    result = score.to_dict()
    # Backward-compat keys: legacy callers / frontend expect these names.
    result["fixes"] = result.get("suggestions", [])
    result["violations"] = [i["message"] for i in result.get("issues", [])]
    result["section_count"] = score.section_count
    # Explicit state for the UI: "pending" (background detection running),
    # "unavailable" (detector not set up), or "scored" (real arrangement score).
    if structure_result.get("deferred"):
        result["arrangement_status"] = "pending"
    elif structure_result.get("available") is False:
        result["arrangement_status"] = "unavailable"
    else:
        result["arrangement_status"] = "scored"
    logger.debug(
        "Phase 7: genre=%s grade=%s score=%.1f sections=%d",
        genre, score.grade, score.overall_score, score.section_count,
    )
    return result
