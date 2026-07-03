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
import os
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

from . import object_store
from .db_sync import SessionFactory
from .tasks_dramatiq import LOCAL_ROOT, _utc_now

logger = logging.getLogger(__name__)


def _structure_time_limit_ms() -> int:
    """Dramatiq hard time limit for the actor — must exceed the allin1 subprocess
    timeout (ALLIN1_TIMEOUT, default 1800 s) plus merge/write overhead, else
    dramatiq kills a legitimately-running CPU analysis mid-flight."""
    try:
        timeout_s = int(os.getenv("ALLIN1_TIMEOUT", "") or 1800)
    except ValueError:
        timeout_s = 1800
    return (timeout_s + 300) * 1000

try:
    from audio_analysis import detect_structure_and_rescore
except ImportError:  # pragma: no cover
    logger.warning("audio_analysis not installed — detect_structure_job will raise on dispatch")
    detect_structure_and_rescore = None  # type: ignore[assignment]


@dramatiq.actor(
    actor_name="detect_structure_job",
    queue_name="analysis-paid",  # story 2.5: secondary op → W1, like rerun_phase
    max_retries=1,
    # Must exceed the allin1 subprocess timeout — demucs on a full-length CPU
    # track runs ~10-20 min (see ALLIN1_TIMEOUT). 600 s killed real songs.
    time_limit=_structure_time_limit_ms(),
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
    # A missing job/analysis means a stale or orphaned message (e.g. enqueued
    # against a DB that's since been reset). It is NOT retryable — no-op so it
    # doesn't retry-spam. This actor is auto-enqueued, so unlike the
    # user-initiated rerun_phase actor we never want it to raise on a missing row.
    with SessionFactory.begin() as s:
        job = s.get(AnalysisJob, sjid)
        if job is None:
            logger.warning(
                "detect_structure_job: structure job %s not found (stale/orphaned "
                "message) — skipping", structure_job_id,
            )
            return
        analysis = s.get(Analysis, aid)
        if analysis is None:
            logger.warning(
                "detect_structure_job: analysis %s not found — marking structure "
                "job failed", analysis_id,
            )
            job.status = JOB_STATUS_FAILED
            job.error_message = "Analysis not found for structure detection."
            job.failed_at = _utc_now()
            job.current_phase = "failed"
            return
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
    report_job_id: uuid.UUID | None = None
    with SessionFactory.begin() as s:
        row = s.get(Analysis, aid)
        if row is None:
            raise RuntimeError(f"analysis {analysis_id} disappeared mid-structure-detect")
        row.final_json = merged_safe
        report_job_id = getattr(row, "job_id", None)

        j = s.get(AnalysisJob, sjid)
        if j is not None:
            j.status = JOB_STATUS_COMPLETE
            j.phase_pct = 1.0
            j.current_phase = "complete"
            j.completed_at = _utc_now()
            j.error_message = None
            j.failed_at = None

    # Story 3.3 (AC2) — refresh the durable R2 report; without this the
    # deferred structure merge leaves reports/{jobId}.json stale on every job.
    if report_job_id is not None and object_store.s3_enabled():
        try:
            object_store.put_json(f"reports/{report_job_id}.json", merged_safe)
        except Exception:  # best-effort — never fail a completed merge over it
            logger.warning("durable report refresh failed job=%s", report_job_id, exc_info=True)

    logger.info(
        "detect_structure_job: complete job=%s analysis=%s", structure_job_id, analysis_id
    )
