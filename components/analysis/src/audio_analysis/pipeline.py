"""Main pipeline orchestrator — run_pipeline() is the single public entry point."""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path

from .coach import generate_coached_fixes
from .converters import to_wav
from .recommendations import translation_fixes
from .schemas import ANALYSIS_SCHEMA_VERSION, PhaseResult, PipelineResult
from .scorers.danceability import danceability_score
from .phases import (
    phase1_universal,
    phase2_genre,
    phase3_genre_specific,
    phase4_stems,
    phase5_reference,
    phase6_gap,
    phase7_arrangement,
    phase9_translation,
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
    (9, "Mix Translation"),
]

# Phase-number → display name (phases 1–7; phase 8 is the conditional ALS step).
_PHASE_NAMES = {num: name for num, name in PHASE_DEFS}


def run_single_phase(
    phase_num: int,
    *,
    wav_path,
    phase_data: dict[int, dict],
    reference_path: str | None = None,
    als_file_path: str | None = None,
    stem_paths: dict | None = None,
    reference_stem_paths: dict | None = None,
    genre_hint: str | None = None,
    stem_mode: str = "grouped",
    defer_structure: bool = False,
    progress_cb=None,
) -> PhaseResult:
    """Run one phase (1–7) against an already-converted WAV and return its
    :class:`PhaseResult`.

    Any upstream data the phase needs (phase-1 output, detected genre, structure)
    is read from *phase_data* — it is NOT mutated here; the caller is responsible
    for folding the returned ``data`` back in on success. Phase 8 (ALS) is handled
    by the caller, not this function. Behaviour mirrors the original ``run_pipeline``
    loop body exactly (same dispatch args, logging, progress_cb, try/except).
    """
    phase_name = _PHASE_NAMES.get(phase_num, f"Phase {phase_num}")
    if progress_cb:
        progress_cb(phase_num, phase_name, 0.0)
    logger.info("phase %d (%s) starting", phase_num, phase_name)
    t0 = time.perf_counter()
    try:
        if phase_num == 1:
            data = phase1_universal.analyze(wav_path, progress_cb, defer_structure=defer_structure)
        elif phase_num == 2:
            data = phase2_genre.classify(wav_path, phase_data.get(1, {}), progress_cb, genre_hint=genre_hint)
        elif phase_num == 3:
            genre = phase_data.get(2, {}).get("genre", "other")
            data = phase3_genre_specific.score(
                wav_path, genre, phase_data.get(1, {}), progress_cb
            )
        elif phase_num == 4:
            data = phase4_stems.analyze(
                wav_path, progress_cb, stem_paths=stem_paths, stem_mode=stem_mode,
            )
        elif phase_num == 5:
            genre = phase_data.get(2, {}).get("genre", "other")
            data = phase5_reference.compare(
                wav_path, reference_path, phase_data.get(1, {}), progress_cb,
                genre=genre,
                user_stem_paths=stem_paths,
                reference_stem_paths=reference_stem_paths,
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
        elif phase_num == 9:
            data = phase9_translation.analyze(wav_path, progress_cb)
        else:
            data = {}

        elapsed = time.perf_counter() - t0
        logger.info("phase %d (%s) done in %.1fs", phase_num, phase_name, elapsed)
        result = PhaseResult(
            phase=phase_num,
            name=phase_name,
            status="ok",
            data=data,
            error=None,
        )
        if progress_cb:
            progress_cb(phase_num, phase_name, 1.0)
        return result

    except Exception as exc:
        elapsed = time.perf_counter() - t0
        logger.exception("phase %d (%s) FAILED after %.1fs: %s", phase_num, phase_name, elapsed, exc)
        return PhaseResult(
            phase=phase_num,
            name=phase_name,
            status="failed",
            data={},
            error=str(exc),
        )


def finalize_result(
    phase_data: dict[int, dict],
    phase_results: list[PhaseResult],
    file_path: str,
) -> PipelineResult:
    """Derive the top-level rollups from the full phase set and assemble the
    :class:`PipelineResult`. Shared by ``run_pipeline`` (full run) and
    ``rerun_single_phase`` (in-place per-phase re-run) so both stay consistent.
    """
    ok_phases = [r for r in phase_results if r["status"] == "ok"]
    if phase_data.get(3):
        overall_score = float(phase_data[3].get("total_score", 50.0))
    else:
        overall_score = 50.0 * (len(ok_phases) / len(PHASE_DEFS))

    grade = _score_to_grade(overall_score)
    top_fixes = _extract_fixes(phase_data)

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

    coaching = generate_coached_fixes(
        {**p1, "translation": phase_data.get(9, {}), "top_fixes": top_fixes}
    )

    return PipelineResult(
        file_path=str(file_path),
        analysis_schema_version=ANALYSIS_SCHEMA_VERSION,
        phases=phase_results,
        overall_score=overall_score,
        grade=grade,
        top_fixes=top_fixes,
        danceability_score=dance_score,
        coach_name=coaching["coach_name"],
        coach_intro=coaching["coach_intro"],
        coached_fixes=coaching["coached_fixes"],
    )


def run_pipeline(
    file_path: str,
    reference_path: str | None = None,
    als_file_path: str | None = None,
    genre_hint: str | None = None,
    progress_cb=None,
    stem_paths: dict | None = None,
    reference_stem_paths: dict | None = None,
    stem_mode: str = "grouped",
    defer_structure: bool = False,
) -> PipelineResult:
    """Run all 7 analysis phases (+ optional ALS phase 8) and return a structured
    result dict.

    When *defer_structure* is True, Phase 1 skips the ~60-90 s allin1 structure
    step and emits a "deferred" placeholder; a background job fills it in later
    via :func:`detect_structure_and_rescore`. Phase 7 then scores "pending"
    rather than blocking the whole run.

    The input *file_path* is converted to a temporary 44100 Hz WAV before any phase
    runs.  The temp file is always deleted in the ``finally`` block — even if the
    pipeline raises an unhandled exception.

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

        for phase_num, _phase_name in PHASE_DEFS:
            pr = run_single_phase(
                phase_num,
                wav_path=wav_path,
                phase_data=phase_data,
                reference_path=reference_path,
                als_file_path=als_file_path,
                stem_paths=stem_paths,
                reference_stem_paths=reference_stem_paths,
                genre_hint=genre_hint,
                stem_mode=stem_mode,
                defer_structure=defer_structure,
                progress_cb=progress_cb,
            )
            phase_results.append(pr)
            if pr["status"] == "ok":
                phase_data[phase_num] = pr["data"]

        # Phase 8: ALS analysis (skipped when als_file_path is None)
        if progress_cb:
            progress_cb(8, "ALS Analysis", 0.0)
        phase8 = analyze_als(als_file_path)
        phase_results.append(PhaseResult(**phase8))
        if progress_cb:
            progress_cb(8, "ALS Analysis", 1.0)

        return finalize_result(phase_data, phase_results, file_path)
    finally:
        if wav_path is not None and os.path.exists(wav_path):
            try:
                os.unlink(wav_path)
            except OSError:
                logger.warning("Could not delete temp WAV: %s", wav_path)


def rerun_single_phase(
    phase_num: int,
    file_path: str,
    prior_result: PipelineResult | dict,
    *,
    reference_path: str | None = None,
    als_file_path: str | None = None,
    stem_paths: dict | None = None,
    reference_stem_paths: dict | None = None,
    stem_mode: str = "grouped",
    progress_cb=None,
) -> PipelineResult:
    """Re-run a single phase and merge it into *prior_result* in place, re-deriving
    the rollups. Every other phase is preserved byte-for-byte.

    Inputs for the re-run come from the stored result: the prior ``phases`` list is
    rebuilt into a ``phase_data`` map (ok phases only) so dependent phases (3/5/6/7)
    get phase-1 output + genre without recomputing them. Phases 2–7 re-convert the
    audio to WAV; phase 8 re-parses the ``.als``. No cascade — re-running phase N
    does NOT re-run its dependents.
    """
    prior_phases = list(prior_result.get("phases", []))
    phase_data: dict[int, dict] = {
        p["phase"]: p["data"] for p in prior_phases if p.get("status") == "ok"
    }

    wav_path: Path | None = None
    try:
        if phase_num == 8:
            if progress_cb:
                progress_cb(8, "ALS Analysis", 0.0)
            new_pr = PhaseResult(**analyze_als(als_file_path))
            if progress_cb:
                progress_cb(8, "ALS Analysis", 1.0)
        else:
            wav_path = to_wav(file_path)
            new_pr = run_single_phase(
                phase_num,
                wav_path=wav_path,
                phase_data=phase_data,
                reference_path=reference_path,
                als_file_path=als_file_path,
                stem_paths=stem_paths,
                reference_stem_paths=reference_stem_paths,
                genre_hint=None,
                stem_mode=stem_mode,
                progress_cb=progress_cb,
            )

        # Replace the existing entry for this phase (append if it wasn't present).
        replaced = False
        for i, p in enumerate(prior_phases):
            if p.get("phase") == phase_num:
                prior_phases[i] = new_pr
                replaced = True
                break
        if not replaced:
            prior_phases.append(new_pr)

        if new_pr["status"] == "ok":
            phase_data[phase_num] = new_pr["data"]
        else:
            phase_data.pop(phase_num, None)

        return finalize_result(phase_data, prior_phases, str(file_path))
    finally:
        if wav_path is not None and os.path.exists(wav_path):
            try:
                os.unlink(wav_path)
            except OSError:
                logger.warning("Could not delete temp WAV: %s", wav_path)


def detect_structure_and_rescore(
    file_path: str,
    prior_result: PipelineResult | dict,
    *,
    use_gpu: bool | None = None,
    progress_cb=None,
) -> PipelineResult:
    """Run allin1 structure detection, fold it into *prior_result*'s Phase 1,
    then re-score Phase 7 and re-derive the rollups.

    This is the background half of deferred structure detection: the main run
    used ``defer_structure=True`` (Phase 1 emitted a "deferred" placeholder); a
    worker later calls this to fill it in. Patches the Phase-1 ``structure``
    sub-dict in place, then delegates to :func:`rerun_single_phase` for Phase 7
    so every other phase is preserved byte-for-byte.

    On :class:`Allin1Unavailable` (or any analysis error) the Phase-1 structure
    is patched to the honest non-deferred unavailable shape and Phase 7 still
    re-runs (→ "not assessed"). This never raises for an unavailable detector —
    it resolves the deferred state one way or the other.
    """
    from audio_analysis.structure.docker_allin1 import (
        Allin1Unavailable,
        DockerAllin1,
        structure_dict_from_result,
    )

    if progress_cb:
        progress_cb(7, "Arrangement", 0.0)

    try:
        result = DockerAllin1(use_gpu=use_gpu).analyze(file_path)
        structure = structure_dict_from_result(result)
    except Allin1Unavailable as exc:
        logger.warning("Deferred structure detection unavailable: %s", exc)
        structure = {"available": False, "reason": str(exc), "segments": [], "beats": []}
    except Exception as exc:  # noqa: BLE001 — resolve deferred state; don't crash the job
        logger.warning("Deferred structure detection failed: %s", exc)
        structure = {
            "available": False,
            "reason": f"allin1 analysis error: {exc}",
            "segments": [],
            "beats": [],
        }

    # Fold the detected structure into the stored Phase-1 data, then re-score 7.
    patched = dict(prior_result)
    phases = [dict(p) for p in patched.get("phases", [])]
    for p in phases:
        if p.get("phase") == 1 and isinstance(p.get("data"), dict):
            p["data"] = {**p["data"], "structure": structure}
            break
    patched["phases"] = phases

    return rerun_single_phase(7, file_path, patched, progress_cb=progress_cb)


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

    # Priority 0: mix-translation fixes from phase 9 (mono collapse, weak bass
    # translation, headphone fatigue). These are playback-failure issues, so they
    # outrank arrangement nits — cap at 2 to leave room for other categories.
    fixes.extend(translation_fixes(phase_data.get(9))[:2])

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
