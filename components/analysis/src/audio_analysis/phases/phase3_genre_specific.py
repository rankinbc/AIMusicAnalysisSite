"""Phase 3 — Genre-specific scoring rubrics."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Per-genre scorers
# ---------------------------------------------------------------------------

def _trance_score(bands: dict, stereo_width: float, bpm: float) -> dict:
    sub_scores: dict[str, float] = {}
    notes: list[str] = []

    # Air band energy (trance hallmark — high-frequency shimmer)
    air = bands.get("air", -40.0)
    sub_scores["air_energy"] = max(0.0, min(100.0, (air + 40.0) / 0.2))
    if air < -30.0:
        notes.append("Increase high-frequency content (air band) for trance shimmer")

    # Stereo width
    sub_scores["stereo_width"] = min(100.0, stereo_width * 100.0)
    if stereo_width < 0.5:
        notes.append("Widen stereo field — trance benefits from wide supersaws/pads")

    # BPM range adherence
    bpm_score = 100.0 if 130.0 <= bpm <= 150.0 else max(0.0, 100.0 - abs(bpm - 140.0) * 5.0)
    sub_scores["bpm_adherence"] = bpm_score
    if bpm_score < 70.0:
        notes.append(f"BPM {bpm:.1f} is outside typical trance range (130-150)")

    score = float(sum(sub_scores.values()) / len(sub_scores))
    return {"score": score, "sub_scores": sub_scores, "notes": notes}


def _house_score(bands: dict, stereo_width: float, bpm: float) -> dict:
    sub_scores: dict[str, float] = {}
    notes: list[str] = []

    # Sub-bass + bass energy
    sub_bass = bands.get("sub_bass", -40.0)
    bass = bands.get("bass", -40.0)
    bass_avg = (sub_bass + bass) / 2.0
    sub_scores["bass_energy"] = max(0.0, min(100.0, (bass_avg + 30.0) / 0.15))
    if bass_avg < -20.0:
        notes.append("Boost sub-bass and bass band energy for a fuller house groove")

    # BPM range
    bpm_score = 100.0 if 120.0 <= bpm < 130.0 else max(0.0, 100.0 - abs(bpm - 125.0) * 8.0)
    sub_scores["bpm_adherence"] = bpm_score
    if bpm_score < 70.0:
        notes.append(f"BPM {bpm:.1f} is outside typical house range (120-130)")

    score = float(sum(sub_scores.values()) / len(sub_scores))
    return {"score": score, "sub_scores": sub_scores, "notes": notes}


def _techno_score(bands: dict, stereo_width: float, bpm: float) -> dict:
    sub_scores: dict[str, float] = {}
    notes: list[str] = []

    # Presence + upper-mid energy
    presence = bands.get("presence", -40.0)
    upper_mid = bands.get("upper_mid", -40.0)
    mid_avg = (presence + upper_mid) / 2.0
    sub_scores["mid_presence"] = max(0.0, min(100.0, (mid_avg + 30.0) / 0.15))
    if mid_avg < -25.0:
        notes.append("Boost presence and upper-mid for a harder techno character")

    # Minimal air (techno should be more mid-focused than trance)
    air = bands.get("air", -40.0)
    sub_scores["minimal_air"] = max(0.0, min(100.0, ((-air) / 0.4)))
    if air > -15.0:
        notes.append("High-shelf cut above 10 kHz will tighten the techno sound")

    # BPM range
    bpm_score = 100.0 if 130.0 <= bpm <= 140.0 else max(0.0, 100.0 - abs(bpm - 135.0) * 5.0)
    sub_scores["bpm_adherence"] = bpm_score
    if bpm_score < 70.0:
        notes.append(f"BPM {bpm:.1f} is outside typical techno range (130-140)")

    score = float(sum(sub_scores.values()) / len(sub_scores))
    return {"score": score, "sub_scores": sub_scores, "notes": notes}


def _dnb_score(bands: dict, stereo_width: float, bpm: float) -> dict:
    sub_scores: dict[str, float] = {}
    notes: list[str] = []

    # Heavy sub-bass
    sub_bass = bands.get("sub_bass", -40.0)
    sub_scores["sub_bass_weight"] = max(0.0, min(100.0, (sub_bass + 30.0) / 0.15))
    if sub_bass < -20.0:
        notes.append("Boost sub-bass for a harder DnB low-end hit")

    # BPM range
    bpm_score = 100.0 if 160.0 <= bpm <= 180.0 else max(0.0, 100.0 - abs(bpm - 170.0) * 5.0)
    sub_scores["bpm_adherence"] = bpm_score
    if bpm_score < 70.0:
        notes.append(f"BPM {bpm:.1f} is outside typical DnB range (160-180)")

    score = float(sum(sub_scores.values()) / len(sub_scores))
    return {"score": score, "sub_scores": sub_scores, "notes": notes}


def _other_score(bands: dict, stereo_width: float, bpm: float) -> dict:
    """Generic assessment for unclassified genres."""
    sub_scores: dict[str, float] = {}
    notes: list[str] = []

    # Balanced frequency distribution
    band_vals = list(bands.values())
    if band_vals:
        spread = max(band_vals) - min(band_vals)
        balance_score = max(0.0, 100.0 - spread * 0.5)
        sub_scores["frequency_balance"] = balance_score
        if balance_score < 60.0:
            notes.append("Large frequency imbalance detected — consider EQ correction")

    # Stereo width
    sub_scores["stereo_width"] = min(100.0, stereo_width * 80.0)

    score = float(sum(sub_scores.values()) / len(sub_scores)) if sub_scores else 50.0
    return {"score": score, "sub_scores": sub_scores, "notes": notes}


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

_SCORERS = {
    "trance": _trance_score,
    "house": _house_score,
    "techno": _techno_score,
    "dnb": _dnb_score,
}


def score(
    wav_path: Path,
    genre: str,
    phase1_result: dict,
    progress_cb: Callable | None = None,
) -> dict:
    """Compute genre-specific score for *wav_path*.

    Args:
        wav_path:      Path to the 44100 Hz WAV (available for future use).
        genre:         Detected genre string from Phase 2.
        phase1_result: Output dict from :func:`phase1_universal.analyze`.
        progress_cb:   Optional ``(phase, name, pct)`` progress callback.

    Returns:
        dict with keys: genre, total_score, sub_scores, notes.
    """
    bands: dict = phase1_result.get("bands", {})
    stereo_width: float = phase1_result.get("stereo_width", 0.0)
    bpm: float = phase1_result.get("bpm", 120.0)

    scorer = _SCORERS.get(genre, _other_score)
    result = scorer(bands, stereo_width, bpm)

    logger.debug("Phase 3: genre=%s total_score=%.1f", genre, result["score"])

    return {
        "genre": genre,
        "total_score": result["score"],
        "sub_scores": result["sub_scores"],
        "notes": result["notes"],
    }
