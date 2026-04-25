"""Phase 2 — Rules-based genre classification from Phase 1 features."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable

logger = logging.getLogger(__name__)


def classify(
    wav_path: Path,
    phase1_result: dict,
    progress_cb: Callable | None = None,
) -> dict:
    """Classify genre from BPM and spectral features derived in Phase 1.

    Args:
        wav_path:      Path to the 44100 Hz WAV (available for future use).
        phase1_result: Output dict from :func:`phase1_universal.analyze`.
        progress_cb:   Optional ``(phase, name, pct)`` progress callback.

    Returns:
        dict with keys: genre, confidence, bpm.
    """
    bpm: float = phase1_result.get("bpm", 120.0)
    bands: dict = phase1_result.get("bands", {})
    presence_energy: float = bands.get("presence", -40.0)

    # -------------------------------------------------------------------
    # Primary BPM-based classification
    # -------------------------------------------------------------------
    if 160.0 <= bpm <= 180.0:
        genre, confidence = "dnb", 0.75
    elif 130.0 <= bpm <= 150.0:
        genre, confidence = "trance", 0.70
    elif 120.0 <= bpm < 130.0:
        genre, confidence = "house", 0.65
    else:
        genre, confidence = "other", 0.50

    # -------------------------------------------------------------------
    # Refinement: high presence energy + BPM 128-140 → lean techno
    # Techno overlaps with trance in the 130-140 BPM range
    # -------------------------------------------------------------------
    if presence_energy > -20.0 and 128.0 <= bpm <= 140.0:
        genre, confidence = "techno", 0.60

    logger.debug("Phase 2: bpm=%.1f genre=%s confidence=%.2f", bpm, genre, confidence)

    return {"genre": genre, "confidence": confidence, "bpm": bpm}
