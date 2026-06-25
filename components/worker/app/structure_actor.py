"""Dramatiq actor for background (deferred) structure detection.

The main ``analyze_audio_job`` runs the pipeline with ``defer_structure=True`` so
the ~60-90 s allin1 step never blocks the analysis. After it persists the
Analysis row it enqueues this actor, which runs allin1, folds the structure into
Phase 1, re-scores Phase 7, and writes the merged ``final_json`` back into the
SAME analysis row — no new Analysis row.

    detect_structure_job(structure_job_id, analysis_id)

The detection + merge + rollup re-derivation all live in
``audio_analysis.detect_structure_and_rescore`` — this actor only loads paths,
calls it, and writes the result back. Mirrors the 3-phase transaction pattern of
``rerun_phase`` (mark processing → run outside a tx → persist + complete). An
unavailable detector is NOT a failure: the helper resolves the deferred state to
"not assessed" and the job still completes.
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
    from audio_analysis import detect_structure_and_rescore
except ImportError:  # pragma: no cover
    logger.warning("audio_analysis not installed — detect_structure_job will raise on dispatch")
    detect_structure_and_rescore = None  # type: ignore[assignment]


@dramatiq.actor(
    actor_name="detect_structure_job",
    queue_name="analysis-paid",  # story 2.5: secondary op → W1, like rerun_phase
    max_retries=1,
    time_limit=600_000,  # 10 minutes (CPU allin1 can take ~90 s)
)
def detect_structure_job(structure_job_id: str, analysis_id: str) -> None:
    if detect_structure_and_rescore is None:
        raise RuntimeError("audio_analysis package not installed in worker environment")

    sjid = uuid.UUID(structure_job_id)
    aid = uuid.UUID(analysis_id)
    logger.info(
        "detect_structure_job: start job=%s analysis=%s", structure_job_id, analysis_id
    )

    # ── Phase A — mark processing + capture inputs ───────────────────────────
    with SessionFactory.begin() as s:
        job = s.get(AnalysisJob, sjid)
        if job is None:
            raise ValueError(f"structure job {structure_job_id} not found")
        analysis = s.get(Analysis, aid)
        if analysis is None:
            raise ValueError(f"analysis {analysis_id} not found")
        version = s.get(SongVersion, analysis.version_id) if analysis.version_id else None

        job.status = JOB_STATUS_PROCESSING
        job.started_at = _utc_now()
        job.current_phase = "Arrangement"
        job.phase_pct = 0.0

        prior_final = analysis.final_json
        file_abs = (
            str((Path(LOCAL_ROOT) / version.file_path).resolve())
            if version and version.file_path
            else None
        )

    if file_abs is None:
        logger.warning("detect_structure_job: no source audio for analysis=%s", analysis_id)
        with SessionFactory.begin() as s:
            j = s.get(AnalysisJob, sjid)
            if j is not None:
                j.status = JOB_STATUS_FAILED
                j.error_message = "Source audio missing for structure detection."
                j.failed_at = _utc_now()
                j.current_phase = "failed"
        return

    def _report_progress(_p: int, name: str, pct: float) -> None:
        frac = max(0.0, min(1.0, pct))
        try:
            with SessionFactory.begin() as ps:
                pj = ps.get(AnalysisJob, sjid)
                if pj is not None:
                    pj.current_phase = name
                    pj.phase_pct = frac
        except Exception:  # best-effort progress
            logger.warning("structure progress update failed", exc_info=True)

    # ── Phase B — run allin1 + merge (no DB tx held) ─────────────────────────
    try:
        merged = detect_structure_and_rescore(
            file_abs, prior_final, progress_cb=_report_progress
        )
        merged_safe = json.loads(json.dumps(merged, default=str))
    except Exception as exc:
        logger.exception("detect_structure_job: FAILED job=%s", structure_job_id)
        with SessionFactory.begin() as s:
            j = s.get(AnalysisJob, sjid)
            if j is not None:
                j.status = JOB_STATUS_FAILED
                j.error_message = str(exc)[:2000]
                j.failed_at = _utc_now()
                j.current_phase = "failed"
        raise

    # ── Phase C — write merged result back + flip the structure job complete ─
    with SessionFactory.begin() as s:
        row = s.get(Analysis, aid)
        if row is None:
            raise RuntimeError(f"analysis {analysis_id} disappeared mid-structure-detect")
        row.final_json = merged_safe

        j = s.get(AnalysisJob, sjid)
        if j is not None:
            j.status = JOB_STATUS_COMPLETE
            j.phase_pct = 1.0
            j.current_phase = "complete"
            j.completed_at = _utc_now()
            j.error_message = None
            j.failed_at = None

    logger.info(
        "detect_structure_job: complete job=%s analysis=%s", structure_job_id, analysis_id
    )
