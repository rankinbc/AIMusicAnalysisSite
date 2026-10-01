"""Per-actor give-up hooks (see ``give_up``). Imported by ``dramatiq_app``
after the actors are registered.

Each hook is idempotent and only moves rows that are still non-terminal, so it
is safe whether or not the actor's own failure arm already ran. Actors with no
user-visible "in progress" state (triage, fix rack, sweeps, email, account
deletion) have no hook — their run log is the record.
"""
from __future__ import annotations

import logging
import uuid

from sqlalchemy import select

from aimusic_shared.models import (
    JOB_STATUS_COMPLETE,
    JOB_STATUS_FAILED,
    AnalysisJob,
    ReferenceTrack,
    SongVersion,
)
from aimusic_shared.models import Verdict as VerdictRow

from .. import coach_actor, reference_analyzer_actor, structure_actor, verdict_actor
from ..db_sync import SessionFactory
from ..tasks_dramatiq import _utc_now
from . import give_up
from .give_up import arg, on_give_up

logger = logging.getLogger(__name__)

_USER_MESSAGES = {
    give_up.REASON_TIMED_OUT: "Processing exceeded its time limit.",
    give_up.REASON_WORKER_CRASHED: (
        "The analysis worker crashed repeatedly on this job, so it was stopped."),
    give_up.REASON_RETRIES_EXHAUSTED: "Processing failed after retrying.",
}


def describe(reason: str, exc: BaseException | None) -> str:
    base = _USER_MESSAGES.get(reason, "Processing failed.")
    return f"{base} ({type(exc).__name__}: {exc})"[:2000] if exc is not None else base


def fail_job_row(job_id: object, reason: str, exc: BaseException | None) -> None:
    """Flip an ``analysis_jobs`` row to failed unless it is already terminal.
    An existing failure message/code (the actor's own, or the BFF reaper's
    ``worker_unavailable``) is kept — only blanks are filled in."""
    if job_id is None:
        return
    with SessionFactory.begin() as s:
        job = s.get(AnalysisJob, uuid.UUID(str(job_id)))
        if job is None or job.status == JOB_STATUS_COMPLETE:
            return
        if job.status != JOB_STATUS_FAILED:
            job.status = JOB_STATUS_FAILED
            job.failed_at = _utc_now()
            job.current_phase = "failed"
        if not job.error_message:
            job.error_message = describe(reason, exc)
        if not job.error_code:
            job.error_code = reason


@on_give_up("analyze_audio_job")
def _analyze(args, kwargs, reason, exc):
    fail_job_row(arg(args, kwargs, 0, "job_id"), reason, exc)


@on_give_up("rerun_phase")
def _rerun(args, kwargs, reason, exc):
    fail_job_row(arg(args, kwargs, 0, "rerun_job_id"), reason, exc)


@on_give_up("detect_structure_job")
def _structure(args, kwargs, reason, exc):
    fail_job_row(arg(args, kwargs, 0, "structure_job_id"), reason, exc)
    aid = arg(args, kwargs, 1, "analysis_id")
    if aid is not None:
        structure_actor.mark_arrangement_failed(uuid.UUID(str(aid)), describe(reason, exc))


@on_give_up("classify_stems")
def _classify(args, kwargs, reason, exc):
    """Same degrade as the actor's own hard-failure arm (E3.1): every entry
    without a role becomes "other", so the BFF poll reports classified=true and
    the review UI falls back to manual assignment instead of spinning."""
    vid = arg(args, kwargs, 0, "version_id")
    if vid is None:
        return
    with SessionFactory.begin() as s:
        version = s.get(SongVersion, uuid.UUID(str(vid)))
        if version is None:
            return
        entries = list(version.stem_paths_raw or [])
        if all(e.get("detected_role") for e in entries):
            return
        updated = []
        for e in entries:
            ne = dict(e)
            if not ne.get("detected_role"):
                ne["detected_role"] = "other"
                ne["confidence"] = 0.0
                ne["evidence"] = "classification unavailable"
            updated.append(ne)
        version.stem_paths_raw = updated  # REASSIGN — JSONB dirty-flag rule


@on_give_up("run_specialist")
def _specialist(args, kwargs, reason, exc):
    aid_raw = arg(args, kwargs, 0, "analysis_id")
    slug = arg(args, kwargs, 1, "slug")
    if aid_raw is None or not slug:
        return
    aid = uuid.UUID(str(aid_raw))
    with SessionFactory.begin() as s:
        exists = s.execute(
            select(VerdictRow.id)
            .where(VerdictRow.analysis_id == aid, VerdictRow.specialist == slug)
            .limit(1)
        ).first()
    if exists is None:
        verdict_actor._persist_fail_marker(aid, slug, describe(reason, exc))


@on_give_up("run_reference_analyzer")
def _reference(args, kwargs, reason, exc):
    rid_raw = arg(args, kwargs, 0, "reference_id")
    if rid_raw is None:
        return
    rid = uuid.UUID(str(rid_raw))
    with SessionFactory.begin() as s:
        ref = s.get(ReferenceTrack, rid)
        status = ref.analysis_status if ref is not None else None
    if ref is not None and status not in ("analyzed", "failed"):
        reference_analyzer_actor._mark_failed(rid, describe(reason, exc))


@on_give_up("coach_reply")
def _coach(args, kwargs, reason, exc):
    # _mark_error only touches a still-`pending` assistant row and stamps the
    # user turn as not-billable — exactly the terminal state we need.
    mid = arg(args, kwargs, 2, "assistant_message_id")
    uid = arg(args, kwargs, 1, "user_message_id")
    if mid is None:
        return
    coach_actor._mark_error(
        uuid.UUID(str(mid)),
        user_message_id=uuid.UUID(str(uid)) if uid is not None else None,
    )
