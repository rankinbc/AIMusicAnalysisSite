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

from . import object_store
from .db_sync import SessionFactory
from .tasks_dramatiq import LOCAL_ROOT, _utc_now

logger = logging.getLogger(__name__)

try:
    from audio_analysis import rerun_single_phase
except ImportError:  # pragma: no cover
    logger.warning("audio_analysis not installed — rerun_phase actor will raise on dispatch")
    rerun_single_phase = None  # type: ignore[assignment]


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
        # Story 3.5 — redelivery guard (mirrors analyze_audio_job): a
        # duplicate message for a finished re-run must not regress it.
        if job.status == JOB_STATUS_COMPLETE:
            logger.info("rerun_phase: job=%s already complete — redelivery no-op", rerun_job_id)
            return
        analysis = s.get(Analysis, aid)
        if analysis is None:
            raise ValueError(f"analysis {analysis_id} not found")
        version = s.get(SongVersion, analysis.version_id) if analysis.version_id else None

        job.status = JOB_STATUS_PROCESSING
        job.started_at = _utc_now()
        job.current_phase = "starting"
        job.phase_pct = 0.0

        prior_final = analysis.final_json
        file_rel = version.file_path if version else None
        reference_rel = version.reference_path if version else None
        als_rel = version.als_file_path if version else None
        stem_paths = version.stem_paths if version else None
        stem_mode = (version.stem_analysis_mode or "grouped") if version else "grouped"

    # Story 3.2 — resolve source/attachments local-first with S3 fetch fallback
    # (presigned-uploaded versions have R2 keys, not local paths). A failed
    # fetch marks the rerun job failed AND cleans any partial fetches — the
    # Phase B finally below only covers fetches that survive to Phase B.
    fetched: list[Path] = []
    try:
        file_abs = None
        if file_rel:
            file_abs, f = object_store.resolve_local(file_rel, LOCAL_ROOT)
            if f is not None:
                fetched.append(f)
        reference_abs = None
        if reference_rel:
            reference_abs, f = object_store.resolve_local(reference_rel, LOCAL_ROOT)
            if f is not None:
                fetched.append(f)
        als_abs = None
        if als_rel:
            als_abs, f = object_store.resolve_local(als_rel, LOCAL_ROOT)
            if f is not None:
                fetched.append(f)
        if stem_paths:
            resolved_stems: dict = {}
            for role, entry in stem_paths.items():
                keys = entry if isinstance(entry, list) else [entry]
                out: list[str] = []
                for k in keys:
                    local, f = object_store.resolve_local(str(k), LOCAL_ROOT)
                    if f is not None:
                        fetched.append(f)
                    out.append(local)
                resolved_stems[role] = out if isinstance(entry, list) else out[0]
            stem_paths = resolved_stems
    except Exception as exc:
        logger.exception("rerun_phase: fetch failed rerun_job=%s", rerun_job_id)
        with SessionFactory.begin() as s:
            j = s.get(AnalysisJob, rerun_jid)
            if j is not None:
                j.status = JOB_STATUS_FAILED
                j.error_message = str(exc)[:2000]
                j.failed_at = _utc_now()
                j.current_phase = "failed"
        object_store.cleanup_all(fetched)
        raise

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
        object_store.cleanup_all(fetched)  # attachments may have been fetched
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
    finally:
        object_store.cleanup_all(fetched)

    # ── Phase C — write merged result back + flip the rerun job complete ─────
    with SessionFactory.begin() as s:
        row = s.get(Analysis, aid)
        if row is None:
            raise RuntimeError(f"analysis {analysis_id} disappeared mid-rerun")
        row.final_json = merged_safe
        report_job_id = getattr(row, "job_id", None)

        j = s.get(AnalysisJob, rerun_jid)
        if j is not None:
            j.status = JOB_STATUS_COMPLETE
            j.phase_pct = 1.0
            j.current_phase = "complete"
            j.completed_at = _utc_now()
            j.error_message = None
            j.failed_at = None

    # Story 3.3 (AC2) — keep the durable R2 report in step with the merged
    # final_json (best-effort; Postgres stays canonical).
    if report_job_id is not None and object_store.s3_enabled():
        try:
            object_store.put_json(f"reports/{report_job_id}.json", merged_safe)
        except Exception:
            logger.warning("durable report refresh failed job=%s", report_job_id, exc_info=True)

    logger.info(
        "rerun_phase: complete rerun_job=%s analysis=%s phase=%s",
        rerun_job_id, analysis_id, phase,
    )
