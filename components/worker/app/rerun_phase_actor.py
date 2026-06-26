"""Dramatiq actor for per-phase re-run.

Re-runs a SINGLE analysis phase against the stored result and merges it back into
``analyses.final_json`` IN PLACE — no new Analysis row. Progress is tracked on a
dedicated re-run ``AnalysisJob`` so the existing job-status / SSE infra surfaces it,
exactly like ``analyze_audio_job``.

    rerun_phase(rerun_job_id, analysis_id, phase)

The phase wiring + merge + rollup re-derivation all live in
``audio_analysis.rerun_single_phase`` — this actor only loads paths, calls it, and
writes the merged ``final_json`` back. Mirrors the 3-phase transaction pattern of
``analyze_audio_job`` (mark processing → run outside a tx → persist + complete).
"""
from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path

import dramatiq

from aimusic_shared.models import (
    JOB_STATUS_COMPLETE,
    JOB_STATUS_FAILED,
    JOB_STATUS_PROCESSING,
    Analysis,
    AnalysisJob,
    SongVersion,
)

from .db_sync import SessionFactory
from .tasks_dramatiq import LOCAL_ROOT, _utc_now

logger = logging.getLogger(__name__)

try:
    from audio_analysis import rerun_single_phase
except ImportError:  # pragma: no cover
    logger.warning("audio_analysis not installed — rerun_phase actor will raise on dispatch")
    rerun_single_phase = None  # type: ignore[assignment]


def _join(rel: str | None) -> str | None:
    return str(Path(LOCAL_ROOT) / rel) if rel else None


@dramatiq.actor(
    actor_name="rerun_phase",
    queue_name="analysis-paid",  # story 2.5: latency-sensitive secondary op → W1
    max_retries=1,
    time_limit=600_000,  # 10 minutes
)
def rerun_phase(
    rerun_job_id: str,
    analysis_id: str,
    phase: int,
    reference_profile: dict | None = None,
) -> None:
    # reference_profile: BFF-resolved phase-6 override (4th positional arg, default
    # None for back-compat with 3-arg callers). kind:"user" carries the embedded
    # aggregate; kind:"genre" carries the genre; None ⇒ worker uses detected genre.
    if rerun_single_phase is None:
        raise RuntimeError("audio_analysis package not installed in worker environment")

    rerun_jid = uuid.UUID(rerun_job_id)
    aid = uuid.UUID(analysis_id)
    phase = int(phase)
    logger.info(
        "rerun_phase: start rerun_job=%s analysis=%s phase=%s",
        rerun_job_id, analysis_id, phase,
    )

    # ── Phase A — mark processing + capture inputs ───────────────────────────
    with SessionFactory.begin() as s:
        job = s.get(AnalysisJob, rerun_jid)
        if job is None:
            raise ValueError(f"rerun job {rerun_job_id} not found")
        analysis = s.get(Analysis, aid)
        if analysis is None:
            raise ValueError(f"analysis {analysis_id} not found")
        version = s.get(SongVersion, analysis.version_id) if analysis.version_id else None

        job.status = JOB_STATUS_PROCESSING
        job.started_at = _utc_now()
        job.current_phase = "starting"
        job.phase_pct = 0.0

        prior_final = analysis.final_json
        file_abs = (
            str((Path(LOCAL_ROOT) / version.file_path).resolve()) if version else None
        )
        reference_abs = _join(version.reference_path) if version else None
        als_abs = _join(version.als_file_path) if version else None
        stem_paths = version.stem_paths if version else None
        stem_mode = (version.stem_analysis_mode or "grouped") if version else "grouped"

    # Phase 8 (ALS) needs no source audio; phases 2–7 do.
    if file_abs is None and phase != 8:
        logger.warning("rerun_phase: no source audio for analysis=%s", analysis_id)
        with SessionFactory.begin() as s:
            j = s.get(AnalysisJob, rerun_jid)
            if j is not None:
                j.status = JOB_STATUS_FAILED
                j.error_message = "Source audio missing for re-run."
                j.failed_at = _utc_now()
                j.current_phase = "failed"
        return

    def _report_progress(p: int, name: str, pct: float) -> None:
        frac = max(0.0, min(1.0, pct))
        try:
            with SessionFactory.begin() as ps:
                pj = ps.get(AnalysisJob, rerun_jid)
                if pj is not None:
                    pj.current_phase = name
                    pj.phase_pct = frac
        except Exception:  # best-effort progress
            logger.warning("rerun progress update failed (phase=%s)", p, exc_info=True)

    # ── Phase B — re-run the single phase + merge (no DB tx held) ────────────
    try:
        merged = rerun_single_phase(
            phase,
            file_abs or "",
            prior_final,
            reference_path=reference_abs,
            als_file_path=als_abs,
            stem_paths=stem_paths,
            stem_mode=stem_mode,
            reference_profile=reference_profile,
            progress_cb=_report_progress,
        )
        # Coerce nested TypedDicts to JSON-safe dict (mirrors analyze_audio_job).
        merged_safe = json.loads(json.dumps(merged, default=str))
    except Exception as exc:
        logger.exception("rerun_phase: FAILED rerun_job=%s", rerun_job_id)
        with SessionFactory.begin() as s:
            j = s.get(AnalysisJob, rerun_jid)
            if j is not None:
                j.status = JOB_STATUS_FAILED
                j.error_message = str(exc)[:2000]
                j.failed_at = _utc_now()
                j.current_phase = "failed"
        raise

    # ── Phase C — write merged result back + flip the rerun job complete ─────
    with SessionFactory.begin() as s:
        row = s.get(Analysis, aid)
        if row is None:
            raise RuntimeError(f"analysis {analysis_id} disappeared mid-rerun")
        row.final_json = merged_safe

        j = s.get(AnalysisJob, rerun_jid)
        if j is not None:
            j.status = JOB_STATUS_COMPLETE
            j.phase_pct = 1.0
            j.current_phase = "complete"
            j.completed_at = _utc_now()
            j.error_message = None
            j.failed_at = None

    logger.info(
        "rerun_phase: complete rerun_job=%s analysis=%s phase=%s",
        rerun_job_id, analysis_id, phase,
    )
