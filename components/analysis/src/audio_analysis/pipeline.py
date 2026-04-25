"""Main pipeline orchestrator — run_pipeline() is the single public entry point."""

from __future__ import annotations

import logging
import os
from pathlib import Path

from .coach import generate_coached_fixes
from .converters import to_wav
from .schemas import PhaseResult, PipelineResult
from .scorers.danceability import danceability_score
from .phases import (
    phase1_universal,
    phase2_genre,
    phase3_genre_specific,
    phase4_stems,
    phase5_reference,
    phase6_gap,
    phase7_arrangement,
)
from .phases.phase8_als import analyze_als

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
    als_file_path: str | None = None,
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
                    genre = phase_data.get(2, {}).get("genre", "other")
                    data = phase5_reference.compare(
                        wav_path, reference_path, phase_data.get(1, {}), progress_cb,
                        genre=genre,
                    )
                elif phase_num == 6:
                    genre = phase_data.get(2, {}).get("genre", "other")
                    data = phase6_gap.analyze(
                        wav_path, genre, phase_data.get(1, {}), progress_cb
                    )
                elif phase_num == 7:
                    structure = phase_data.get(1, {}).get("structure", {})
                    genre = phase_data.get(2, {}).get("genre", "other")
                    bpm = float(phase_data.get(1, {}).get("bpm", 128.0))
                    duration_seconds = float(phase_data.get(1, {}).get("duration_seconds", 0.0))
                    data = phase7_arrangement.advise(
                        structure, genre, progress_cb,
                        bpm=bpm, duration_seconds=duration_seconds,
                    )
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

        # Phase 8: ALS analysis (skipped when als_file_path is None)
        if progress_cb:
            progress_cb(8, "ALS Analysis", 0.0)
        phase8 = analyze_als(als_file_path)
        phase_results.append(PhaseResult(**phase8))
        if progress_cb:
            progress_cb(8, "ALS Analysis", 1.0)

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

        # ------------------------------------------------------------------
        # Danceability score
        # ------------------------------------------------------------------
        p1 = phase_data.get(1, {})
        p2 = phase_data.get(2, {})
        genre = p2.get("genre", "other") or "other"

        onset_density = p2.get("onset_density")
        if onset_density is None:
            dur = p1.get("duration_seconds", 0)
            onset_count = p2.get("onset_count", 0)
            onset_density = float(onset_count) / dur if dur > 0 else 4.0

        dance_score = danceability_score(
            bpm=float(p1.get("bpm", 128.0)),
            onset_density=float(onset_density),
            low_energy=float(p1.get("low_energy", 0.2)),
            genre=str(genre),
        )

        # ------------------------------------------------------------------
        # Coached fixes
        # ------------------------------------------------------------------
        coaching = generate_coached_fixes({**p1, "top_fixes": top_fixes})

        return PipelineResult(
            file_path=str(file_path),
            phases=phase_results,
            overall_score=overall_score,
            grade=grade,
            top_fixes=top_fixes,
            danceability_score=dance_score,
            coach_name=coaching["coach_name"],
            coach_intro=coaching["coach_intro"],
            coached_fixes=coaching["coached_fixes"],
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
    # Prefer new ArrangementScore "suggestions" key; fall back to legacy "fixes".
    fixes.extend(arr.get("suggestions", arr.get("fixes", []))[:3])

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
