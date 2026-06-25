"""Dramatiq actors for the analysis pipeline.

Replaces the legacy Celery ``run_analysis_pipeline`` task. The wire-format
contract with the BFF lives in ``components/bff/src/Spectr.Bff/Services/IJobQueue.cs``
(``DramatiqJobQueue``): the message envelope must match dramatiq's RedisBroker
format and the actor name must be ``analyze_audio_job`` (declares queue
``analysis-free``; the BFF tier-routes the actual enqueue — story 2.5).

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
    JOB_STATUS_PENDING,
    JOB_STATUS_PROCESSING,
    Analysis,
    AnalysisJob,
    ReferenceTrack,
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
    # Story 2.5: MUST be "analysis-free" — this is the SOLE declarer of that queue.
    # A Dramatiq consumer only attaches to a DECLARED queue; if this declared
    # "analysis-paid" instead, W2's {analysis-free, maintenance} whitelist would
    # match nothing and every free job would be orphaned. The BFF tier-routes the
    # actual enqueue queue (analysis-paid for pro/credits); the actor is consumed
    # from BOTH lanes regardless, since dispatch is by actor_name. Do NOT "fix"
    # this to analysis-paid.
    queue_name="analysis-free",
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

        # Reference resolution: a saved library reference (job.reference_id) takes
        # precedence over the one-off reference uploaded with the version
        # (version.reference_path). A missing/deleted reference falls back to the
        # version's one-off path — never crash the job over it. The used_count
        # bump is deferred to Phase C (on success) so a failed pipeline — or a
        # dramatiq retry — doesn't permanently inflate the counter.
        reference_path = version.reference_path
        bump_reference_id: uuid.UUID | None = None
        if job.reference_id is not None:
            ref = s.get(ReferenceTrack, job.reference_id)
            if ref is not None and ref.file_path:
                reference_path = ref.file_path
                bump_reference_id = ref.id

        als_file_path = version.als_file_path
        stem_paths = version.stem_paths
        stem_mode = version.stem_analysis_mode or "grouped"

    # ── Phase B — run pipeline outside any long-held DB transaction ──────────
    # Live per-phase progress: the pipeline calls progress_cb(phase, name, pct)
    # at each phase boundary (and intra-phase for stems). We translate that into
    # an OVERALL 0..1 fraction + the phase name, persisted via short standalone
    # transactions (Phase B holds no transaction — the 3-phase pattern keeps
    # slow work tx-free). The BFF SSE/poll surfaces current_phase + phase_pct.
    total_phases = 8 if als_file_path else 7

    def _report_progress(phase: int, name: str, pct: float) -> None:
        frac = max(0.0, min(1.0, pct))
        overall = max(0.0, min(1.0, (phase - 1 + frac) / total_phases))
        try:
            with SessionFactory.begin() as ps:
                pj = ps.get(AnalysisJob, jid)
                if pj is not None:
                    pj.current_phase = name
                    pj.phase_pct = overall
        except Exception:  # progress is best-effort — never fail the job over it
            logger.warning("progress update failed (phase=%s)", phase, exc_info=True)

    try:
        logger.info("analyze_audio_job: pipeline begin job=%s file=%s", job_id, file_abs)
        pipeline_result = run_pipeline(
            file_path=file_abs,
            reference_path=(str(Path(LOCAL_ROOT) / reference_path) if reference_path else None),
            als_file_path=(str(Path(LOCAL_ROOT) / als_file_path) if als_file_path else None),
            stem_paths=stem_paths,
            stem_mode=stem_mode,
            # Structure detection (~60-90 s allin1) is deferred off the critical
            # path; a background `detect_structure_job` fills Phase 7 in after.
            defer_structure=True,
            progress_cb=_report_progress,
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
    analysis_id = uuid.uuid4()
    with SessionFactory.begin() as s:
        done = s.get(AnalysisJob, jid)
        if done is None:
            # Shouldn't happen — job row was here in Phase A.
            raise RuntimeError(f"job {job_id} disappeared between phases")

        s.add(Analysis(
            id=analysis_id,
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

        # Bump the saved reference's used_count now that the analysis succeeded
        # (deferred from Phase A so failures/retries don't inflate it).
        if bump_reference_id is not None:
            bref = s.get(ReferenceTrack, bump_reference_id)
            if bref is not None:
                bref.used_count = (bref.used_count or 0) + 1

    _try_write_artifact(job_id, result_dict)

    # ── Phase D — kick off background structure detection (fill-in) ──────────
    # The fast phases are now persisted + the job is COMPLETE. Enqueue the heavy
    # allin1 step as its own job so Phase 7 fills in later (best-effort: a
    # failure here never undoes the successful analysis).
    if version_id is not None:
        try:
            _enqueue_structure_detection(user_id, version_id, analysis_id)
        except Exception:  # pragma: no cover — never fail a done analysis over this
            logger.warning("could not enqueue structure detection for job=%s", job_id, exc_info=True)

    logger.info("analyze_audio_job: done job=%s", job_id)


def _enqueue_structure_detection(
    user_id: uuid.UUID,
    version_id: uuid.UUID,
    analysis_id: uuid.UUID,
) -> None:
    """Create a lightweight progress-vehicle AnalysisJob + enqueue the
    ``detect_structure_job`` actor. Imported lazily to avoid an import cycle
    (structure_actor imports paths from this module)."""
    from .structure_actor import detect_structure_job

    structure_job_id = uuid.uuid4()
    with SessionFactory.begin() as s:
        s.add(AnalysisJob(
            id=structure_job_id,
            user_id=user_id,
            version_id=version_id,
            status=JOB_STATUS_PENDING,
            current_phase="queued",
        ))
    detect_structure_job.send(str(structure_job_id), str(analysis_id))
    logger.info(
        "analyze_audio_job: enqueued structure detection job=%s analysis=%s",
        structure_job_id, analysis_id,
    )


@dramatiq.actor(
    actor_name="classify_stems",
    queue_name="analysis-paid",  # story 2.5: paid feature (free tier has stems=false) → W1
    max_retries=1,
    time_limit=600_000,  # 10 minutes
)
def classify_stems(version_id: str) -> None:
    """Audio-content classify each staged stem; write detected roles back to the version.

    Reads ``song_versions.stem_paths_raw`` (a list of staged-stem dicts), resolves
    each ``path`` against LOCAL_ROOT, classifies by sound (import-light, no demucs),
    and writes ``detected_role`` / ``confidence`` / ``evidence`` back so the BFF's
    GET /stems poll can return proposals. Classification is best-effort per file
    (failures map to role "other"), so every row always ends with a detected_role.
    """
    from audio_analysis.stems import classify_stems as classify_audio

    vid = uuid.UUID(version_id)
    logger.info("classify_stems: start version=%s", version_id)

    with SessionFactory.begin() as s:
        version = s.get(SongVersion, vid)
        if version is None:
            raise ValueError(f"version {version_id} not found")
        entries = list(version.stem_paths_raw or [])
        if not entries:
            logger.info("classify_stems: no staged stems for version=%s", version_id)
            return

        abs_paths = [Path((Path(LOCAL_ROOT) / e["path"]).resolve()) for e in entries]
        # On-disk paths are UUIDs; pass the authoritative export name so the classifier
        # can keyword-match (Kick/Snare/Bass/...) before falling back to audio content.
        names = [e.get("original_filename") or Path(e["path"]).name for e in entries]
        proposals = classify_audio(abs_paths, names)

        updated = []
        for e, prop in zip(entries, proposals):
            ne = dict(e)
            ne["detected_role"] = prop.role.value
            ne["confidence"] = round(float(prop.confidence), 3)
            ne["evidence"] = prop.evidence
            updated.append(ne)
        # Reassign so SQLAlchemy flags the JSONB column dirty (in-place mutation
        # of a JSON list is not tracked).
        version.stem_paths_raw = updated

    logger.info("classify_stems: done version=%s (%d stems)", version_id, len(entries))


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
