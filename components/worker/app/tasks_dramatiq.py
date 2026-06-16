"""Dramatiq actors for the analysis pipeline.

Replaces the legacy Celery ``run_analysis_pipeline`` task. The wire-format
contract with the BFF lives in ``components/bff/src/Spectr.Bff/Services/IJobQueue.cs``
(``DramatiqJobQueue``): the message envelope must match dramatiq's RedisBroker
format and the actor name must be ``analyze_audio_job`` (queue ``default``).

Job lifecycle:

    pending  →  processing  →  complete|failed

The pipeline call is wrapped between two short DB transactions so the
long-running CPU work doesn't hold a Postgres connection.
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import dramatiq

from aimusic_shared.models import (
    JOB_STATUS_COMPLETE,
    JOB_STATUS_FAILED,
    JOB_STATUS_PROCESSING,
    Analysis,
    AnalysisJob,
    Song,
    SongVersion,
)

from .db_sync import SessionFactory

logger = logging.getLogger(__name__)

# Local file storage root. The BFF stores upload keys like "audio/upload/{jobId}/source.wav";
# this joins them with LOCAL_ROOT to get the absolute path.
def _default_local_root() -> str:
    """Storage root to use when ``STORAGE_LOCAL_ROOT`` is unset.

    Inside the Linux container the data volume is mounted at ``/data``. For
    local dev — notably Windows, where ``/data`` resolves to ``C:\\data`` and
    misses the file the BFF wrote under the repo's ``data/`` dir — fall back to
    the repo-root ``data/`` dir, mirroring the BFF's ``../../../../data``
    auto-resolution.
    """
    if os.name == "nt":
        # components/worker/app/tasks_dramatiq.py → repo root is 3 levels up from app/.
        return str(Path(__file__).resolve().parents[3] / "data")
    return "/data"


def _resolve_local_root() -> str:
    return os.environ.get("STORAGE_LOCAL_ROOT") or _default_local_root()


LOCAL_ROOT = _resolve_local_root()

# Per-job JSON artifact directory. Optional — primary storage is `analyses.final_json` in Postgres.
# Derived from LOCAL_ROOT so it follows the same repo-vs-container resolution.
RESULTS_DIR = Path(
    os.environ.get("RESULTS_DIR") or str(Path(LOCAL_ROOT) / "output" / "analysis_results")
)

try:
    from audio_analysis import run_pipeline
except ImportError:
    logger.warning("audio_analysis not installed — actor will raise on dispatch")
    run_pipeline = None  # type: ignore[assignment]


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dramatiq.actor(
    actor_name="analyze_audio_job",
    queue_name="default",
    max_retries=2,
    time_limit=3_600_000,  # 60 minutes
)
def analyze_audio_job(job_id: str) -> None:
    """Run the 7-phase audio analysis pipeline for ``job_id``.

    Phase A: mark job PROCESSING, capture file path + song metadata.
    Phase B: run pipeline (long-running, no DB transaction held).
    Phase C: persist Analysis row + flip job to COMPLETE.

    On exception in Phase B we rollback, mark FAILED with the error message,
    and re-raise so dramatiq can apply its retry policy.
    """
    if run_pipeline is None:
        raise RuntimeError("audio_analysis package not installed in worker environment")

    jid = uuid.UUID(job_id)
    logger.info("analyze_audio_job: start job=%s", job_id)

    # ── Phase A — mark processing + capture paths ────────────────────────────
    with SessionFactory.begin() as s:
        job = s.get(AnalysisJob, jid)
        if job is None:
            raise ValueError(f"job {job_id} not found")
        if job.version_id is None:
            raise ValueError(f"job {job_id} has no version_id")
        version = s.get(SongVersion, job.version_id)
        if version is None:
            raise ValueError(f"version {job.version_id} not found")
        song = s.get(Song, version.song_id)

        job.status = JOB_STATUS_PROCESSING
        job.started_at = _utc_now()
        job.current_phase = "starting"
        job.phase_pct = 0.0

        file_rel = version.file_path
        file_abs = str((Path(LOCAL_ROOT) / file_rel).resolve())
        user_id = job.user_id
        version_id = version.id
        song_id = version.song_id
        song_name = song.name if song is not None else None
        reference_path = version.reference_path
        als_file_path = version.als_file_path
        stem_paths = version.stem_paths

    # ── Phase B — run pipeline outside any DB transaction ────────────────────
    try:
        logger.info("analyze_audio_job: pipeline begin job=%s file=%s", job_id, file_abs)
        pipeline_result = run_pipeline(
            file_path=file_abs,
            reference_path=(str(Path(LOCAL_ROOT) / reference_path) if reference_path else None),
            als_file_path=(str(Path(LOCAL_ROOT) / als_file_path) if als_file_path else None),
            stem_paths=stem_paths,
        )
        # The pipeline returns a TypedDict that may contain nested TypedDicts —
        # coerce to plain JSON-safe dict so SA's JSONB serializer doesn't
        # re-wrap a string in quotes.
        result_dict = json.loads(json.dumps(pipeline_result, default=str))
        logger.info("analyze_audio_job: pipeline complete job=%s", job_id)
    except Exception as exc:
        logger.exception("analyze_audio_job: FAILED job=%s", job_id)
        with SessionFactory.begin() as s:
            failed = s.get(AnalysisJob, jid)
            if failed is not None:
                failed.status = JOB_STATUS_FAILED
                failed.error_message = str(exc)[:2000]
                failed.failed_at = _utc_now()
                failed.current_phase = "failed"
        raise

    # ── Phase C — persist Analysis row + flip job to COMPLETE ───────────────
    with SessionFactory.begin() as s:
        done = s.get(AnalysisJob, jid)
        if done is None:
            # Shouldn't happen — job row was here in Phase A.
            raise RuntimeError(f"job {job_id} disappeared between phases")

        s.add(Analysis(
            id=uuid.uuid4(),
            job_id=jid,
            user_id=user_id,
            version_id=version_id,
            song_id=song_id,
            song_name=song_name,
            # JSONB columns take a Python dict — SA serializes it as JSON.
            # Passing a json.dumps()'d string would double-encode.
            final_json=result_dict,
            phase_durations={},
            # EF entities set created_at via a C#-side default which doesn't
            # apply when SQLAlchemy inserts. Set it explicitly.
            created_at=_utc_now(),
        ))
        done.status = JOB_STATUS_COMPLETE
        done.phase_pct = 1.0
        done.current_phase = "complete"
        done.completed_at = _utc_now()
        # Clear stale failure state from any prior retry attempts so the
        # frontend's `errorMessage`-driven failed-banner doesn't render on
        # a successfully-rerun job (Results page reads `errorMessage` and
        # shows "Analysis failed." whenever the field is non-null,
        # regardless of `status`). Always Nones these two on success.
        done.error_message = None
        done.failed_at = None

    _try_write_artifact(job_id, result_dict)
    logger.info("analyze_audio_job: done job=%s", job_id)


def _try_write_artifact(job_id: str, result_dict: dict) -> None:
    """Best-effort JSON dump alongside the Postgres row.

    Useful for debugging and offline inspection; the canonical store is the
    ``analyses.final_json`` column. Failures here are logged and swallowed.
    """
    try:
        RESULTS_DIR.mkdir(parents=True, exist_ok=True)
        date_str = datetime.now().strftime("%Y-%m-%d")
        out = RESULTS_DIR / f"{date_str}_{job_id}.json"
        out.write_text(json.dumps(result_dict, indent=2, default=str), encoding="utf-8")
    except Exception:
        logger.debug("artifact write failed (non-fatal)", exc_info=True)
