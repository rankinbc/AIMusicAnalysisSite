"""Main pipeline orchestrator — run_pipeline() is the single public entry point."""

from __future__ import annotations

import logging
import os
from pathlib import Path

from .converters import to_wav
from .schemas import PhaseResult, PipelineResult
from .phases import (
    phase1_universal,
    phase2_genre,
    phase3_genre_specific,
    phase4_stems,
    phase5_reference,
    phase6_gap,
    phase7_arrangement,
)

logger = logging.getLogger(__name__)

PHASE_DEFS = [
    (1, "Universal Mix Analysis"),
    (2, "Genre Detection"),
    (3, "Genre-Specific Scoring"),
    (4, "Stem Separation & Clash"),
    (5, "Reference Comparison"),
    (6, "Gap Analysis"),
    (7, "Arrangement Advice"),
]


def run_pipeline(
    file_path: str,
    reference_path: str | None = None,
    progress_cb=None,
) -> PipelineResult:
    """Run all 7 analysis phases and return a structured result dict.

    The input *file_path* is converted to a temporary 44100 Hz WAV before
    any phase runs.  The temp file is always deleted in the ``finally``
    block — even if the pipeline raises an unhandled exception.

    Args:
        file_path:      Path to the uploaded audio file (MP3, FLAC, WAV …).
        reference_path: Optional path to a reference track for Phase 5.
        progress_cb:    Optional callback — ``(phase: int, name: str, pct: float)``.

    Returns:
        :class:`~audio_analysis.schemas.PipelineResult` TypedDict.
    """
    wav_path: Path | None = None
    try:
        wav_path = to_wav(file_path)
        phase_results: list[PhaseResult] = []
        phase_data: dict[int, dict] = {}

        for phase_num, phase_name in PHASE_DEFS:
            if progress_cb:
                progress_cb(phase_num, phase_name, 0.0)
            try:
                if phase_num == 1:
                    data = phase1_universal.analyze(wav_path, progress_cb)
                elif phase_num == 2:
                    data = phase2_genre.classify(wav_path, phase_data.get(1, {}), progress_cb)
                elif phase_num == 3:
                    genre = phase_data.get(2, {}).get("genre", "other")
                    data = phase3_genre_specific.score(
                        wav_path, genre, phase_data.get(1, {}), progress_cb
                    )
                elif phase_num == 4:
                    data = phase4_stems.analyze(wav_path, progress_cb)
                elif phase_num == 5:
                    data = phase5_reference.compare(
                        wav_path, reference_path, phase_data.get(1, {}), progress_cb
                    )
                elif phase_num == 6:
                    genre = phase_data.get(2, {}).get("genre", "other")
                    data = phase6_gap.analyze(
                        wav_path, genre, phase_data.get(1, {}), progress_cb
                    )
                elif phase_num == 7:
                    structure = phase_data.get(1, {}).get("structure", {})
                    genre = phase_data.get(2, {}).get("genre", "other")
                    data = phase7_arrangement.advise(structure, genre, progress_cb)
                else:
                    data = {}

                phase_data[phase_num] = data
                phase_results.append(
                    PhaseResult(
                        phase=phase_num,
                        name=phase_name,
                        status="ok",
                        data=data,
                        error=None,
                    )
                )
                if progress_cb:
                    progress_cb(phase_num, phase_name, 1.0)

            except Exception as exc:
                phase_results.append(
                    PhaseResult(
                        phase=phase_num,
                        name=phase_name,
                        status="failed",
                        data={},
                        error=str(exc),
                    )
                )
                logger.exception("Phase %d (%s) failed", phase_num, phase_name)

        # ------------------------------------------------------------------
        # Overall score and grade
        # ------------------------------------------------------------------
        ok_phases = [r for r in phase_results if r["status"] == "ok"]
        if phase_data.get(3):
            overall_score = float(phase_data[3].get("total_score", 50.0))
        else:
            overall_score = 50.0 * (len(ok_phases) / len(PHASE_DEFS))

        grade = _score_to_grade(overall_score)
        top_fixes = _extract_fixes(phase_data)

        return PipelineResult(
            file_path=str(file_path),
            phases=phase_results,
            overall_score=overall_score,
            grade=grade,
            top_fixes=top_fixes,
        )
    finally:
        if wav_path is not None and os.path.exists(wav_path):
            try:
                os.unlink(wav_path)
            except OSError:
                logger.warning("Could not delete temp WAV: %s", wav_path)


def _score_to_grade(score: float) -> str:
    if score >= 90:
        return "A"
    if score >= 80:
        return "B"
    if score >= 70:
        return "C"
    if score >= 60:
        return "D"
    return "F"


def _extract_fixes(phase_data: dict) -> list[str]:
    fixes: list[str] = []

    # Priority 1: arrangement fixes from phase 7
    arr = phase_data.get(7, {})
    fixes.extend(arr.get("fixes", [])[:3])

    # Priority 2: stem clash descriptions from phase 4
    if len(fixes) < 3 and phase_data.get(4, {}).get("clashes"):
        clashes = phase_data[4]["clashes"]
        for c in clashes[:2]:
            fixes.append(
                f"EQ clash between {c.get('stems', 'stems')}: reduce "
                f"{c.get('frequency_range', 'overlapping frequencies')}"
            )

    # Pad to exactly 3 items
    while len(fixes) < 3:
        fixes.append("Optimize mix levels for streaming targets")

    return fixes[:3]
