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
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from . import obs

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


def storage_boot_summary(local_root: str, results_dir: str) -> tuple[str, str | None]:
    """Boot-line fragment + optional warning for the resolved storage root.

    Story 12.3 (AC3): the resolved root was previously invisible, which made a
    compose-only ``STORAGE_LOCAL_ROOT=/data`` leaking into a native run
    undiagnosable. Returns ``(info_fragment, warning_or_None)`` — the warning
    fires when the root directory does not exist. Kept a pure function so
    dramatiq_app's log content is testable without importing the broker, and
    it must never raise (12-2 rule: never crash for a log line).
    """
    fragment = f"storage_root={local_root} results_dir={results_dir}"
    try:
        root_exists = Path(local_root).is_dir()
    except (OSError, ValueError):
        root_exists = False
    warning = None
    if not root_exists:
        warning = (
            f"storage root {local_root} does not exist — uploads will fail file "
            "resolution (compose-only STORAGE_LOCAL_ROOT on a native run?)"
        )
    return fragment, warning

try:
    from audio_analysis import run_pipeline
except ImportError:
    logger.warning("audio_analysis not installed — actor will raise on dispatch")
    run_pipeline = None  # type: ignore[assignment]

# Result-image renderer (spectrogram + waveform). Module-level seam so tests can
# patch it. Optional: a missing import just means no images are produced.
try:
    from audio_analysis.viz import render_analysis_images
except ImportError:
    render_analysis_images = None  # type: ignore[assignment]

# Deterministic Problem engine, run on every completed analysis (healthy path).
# Module-level binding so it's a patchable seam in tests.
from .verdict_lib.degraded import run_rule_engine_for_analysis  # noqa: E402
from .trace import trace_runs_enabled  # noqa: E402

# Story 3.1 — S3/MinIO fetch shim for presigned-uploaded sources (module import
# so tests can patch app.tasks_dramatiq.object_store.*).
from . import object_store  # noqa: E402
from . import source_validation  # noqa: E402


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
    obs.set_correlation(job_id)  # NFR30: the job id IS the correlation id
    _job_started_at = time.monotonic()
    logger.info("analyze_audio_job: start job=%s", job_id)

    # ── Phase A — mark processing + capture paths ────────────────────────────
    with SessionFactory.begin() as s:
        job = s.get(AnalysisJob, jid)
        if job is None:
            raise ValueError(f"job {job_id} not found")
        # Story 3.5 — redelivery guard: a duplicate/redelivered message must
        # be a clean no-op for jobs the user already saw reach a terminal
        # state. COMPLETE: re-running would regress status and hit the unique
        # analyses.job_id index in an IntegrityError retry-loop. FAILED with
        # worker_unavailable: the reaper already told the user to re-run —
        # silently resurrecting it here could double-run against that manual
        # retry. Other failed codes (invalid_file, pipeline errors) stay
        # no-op-free: dramatiq's own max_retries redelivery is the mechanism
        # that legitimately re-enters those. (A mid-run crash redelivery is
        # still `processing` and correctly re-runs.)
        if job.status == JOB_STATUS_COMPLETE or (
            job.status == JOB_STATUS_FAILED and job.error_code == "worker_unavailable"
        ):
            logger.info(
                "analyze_audio_job: job=%s terminal (%s/%s) — redelivery no-op",
                job_id, job.status, job.error_code,
            )
            return
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
        user_id = job.user_id
        # Story 4.5 (AR24): anon jobs carry device_id instead of user_id; the
        # analyses insert must propagate it or ck_analyses_owner_xor fires the
        # moment 6.3 dispatches a device-owned job.
        device_id = job.device_id
        tier = job.tier  # billing tier stamped by the BFF at dispatch (story 2.4)
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

    # Story 3.1/3.2: presigned uploads land in object storage, not the local
    # root. resolve_local is local-first (legacy disk deployments untouched)
    # and fetches from S3 only when the path is absent locally. Story 3.2
    # extends the fetch to ATTACHMENTS (reference/.als/stems) and validates
    # the source at this trust boundary before any pipeline work (AR19).
    fetched: list[Path] = []
    try:
        file_abs, f = object_store.resolve_local(file_rel, LOCAL_ROOT)
        if f is not None:
            fetched.append(f)

        # AR19 — magic-byte + duration validation BEFORE fetching attachments
        # or starting the pipeline. InvalidFileError is handled in its own
        # except arm below (typed fail, no retry, AR16 reversal trigger).
        source_validation.validate_source(file_abs)

        reference_abs: str | None = None
        if reference_path:
            reference_abs, f = object_store.resolve_local(reference_path, LOCAL_ROOT)
            if f is not None:
                fetched.append(f)
        als_abs: str | None = None
        if als_file_path:
            als_abs, f = object_store.resolve_local(als_file_path, LOCAL_ROOT)
            if f is not None:
                fetched.append(f)
        # stem_paths is {role: [key,...]} (or legacy {role: "key"}). Resolve
        # every entry — this also fixes the pre-3.2 inconsistency where stems
        # were passed RAW (CWD-relative) while classify joined LOCAL_ROOT.
        resolved_stems: dict | None = None
        if stem_paths:
            resolved_stems = {}
            for role, entry in stem_paths.items():
                keys = entry if isinstance(entry, list) else [entry]
                out: list[str] = []
                for k in keys:
                    local, f = object_store.resolve_local(str(k), LOCAL_ROOT)
                    if f is not None:
                        fetched.append(f)
                    out.append(local)
                resolved_stems[role] = out if isinstance(entry, list) else out[0]

        logger.info("analyze_audio_job: pipeline begin job=%s file=%s", job_id, file_abs)
        pipeline_result = run_pipeline(
            file_path=file_abs,
            reference_path=reference_abs,
            als_file_path=als_abs,
            stem_paths=resolved_stems,
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
        # Result images (spectrogram + waveform) — rendered outside any DB tx
        # (CPU work). Best-effort: a failure leaves both paths None and the
        # analysis still completes.
        spectrogram_path, waveform_path = _render_and_store_images(job_id, file_abs)
    except source_validation.InvalidFileError as exc:
        # AR19/AR16 — a spoofed/broken upload is PERMANENT: fail fast with the
        # typed code the BFF's reversal hook watches (GET /api/jobs/{id} sees
        # error_code='invalid_file' and refunds the credit spend). No re-raise:
        # dramatiq retries would just re-download and re-fail the same bytes.
        logger.warning("analyze_audio_job: invalid file job=%s (%s)", job_id, exc)
        with SessionFactory.begin() as s:
            failed = s.get(AnalysisJob, jid)
            if failed is not None:
                failed.status = JOB_STATUS_FAILED
                failed.error_code = "invalid_file"
                failed.error_message = str(exc)[:2000]
                failed.failed_at = _utc_now()
                failed.current_phase = "failed"
        obs.JOB_DURATION.labels(tier=tier or "free", status="failed").observe(
            time.monotonic() - _job_started_at)
        return
    except Exception as exc:
        logger.exception("analyze_audio_job: FAILED job=%s", job_id)
        with SessionFactory.begin() as s:
            failed = s.get(AnalysisJob, jid)
            if failed is not None:
                failed.status = JOB_STATUS_FAILED
                failed.error_message = str(exc)[:2000]
                failed.failed_at = _utc_now()
                failed.current_phase = "failed"
        obs.JOB_DURATION.labels(tier=tier or "free", status="failed").observe(
            time.monotonic() - _job_started_at)
        raise
    finally:
        object_store.cleanup_all(fetched)

    # ── Phase C — persist Analysis row + flip job to COMPLETE ───────────────
    analysis_id = uuid.uuid4()
    obs.set_tag("analysis_id", analysis_id)  # cross-lane trace stitch
    with SessionFactory.begin() as s:
        done = s.get(AnalysisJob, jid)
        if done is None:
            # Shouldn't happen — job row was here in Phase A.
            raise RuntimeError(f"job {job_id} disappeared between phases")

        s.add(Analysis(
            id=analysis_id,
            job_id=jid,
            user_id=user_id,
            # AR24 exactly-one: anon jobs propagate device ownership.
            device_id=device_id if user_id is None else None,
            version_id=version_id,
            song_id=song_id,
            song_name=song_name,
            # JSONB columns take a Python dict — SA serializes it as JSON.
            # Passing a json.dumps()'d string would double-encode.
            final_json=result_dict,
            phase_durations={},
            spectrogram_image_path=spectrogram_path,
            waveform_image_path=waveform_path,
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

    obs.JOB_DURATION.labels(tier=tier or "free", status="complete").observe(
        time.monotonic() - _job_started_at)
    _try_write_artifact(job_id, result_dict)
    _try_upload_durables(job_id, result_dict, spectrogram_path, waveform_path)

    # ── Phase C2 — deterministic Problem engine on the completed analysis ────
    # Runs on EVERY successful analysis (not just degraded), so every track gets
    # a de-suppressed, validated Problem list. Idempotent (source-keyed guard)
    # and best-effort: a failure here never undoes the completed analysis.
    try:
        written = run_rule_engine_for_analysis(analysis_id)
        logger.info("problem engine wrote %d problems for job=%s", written, job_id)
    except Exception:  # pragma: no cover — never fail a done analysis over this
        logger.warning("problem engine failed for job=%s", job_id, exc_info=True)

    # ── Phase C3 — LLM identifiers (judgment-only findings; paid-tier gated) ──
    # Runs only on paid tiers (identifiers_enabled): free/anon analyses skip it.
    # Best-effort: a failure never undoes the completed analysis. When tracing is
    # on, each LLM call's full request/response is captured for the run trace.
    _ident_calls: list[dict] = []
    try:
        from .verdict_lib.identifiers import run_llm_identifiers_for_analysis  # noqa: PLC0415
        n_ident = run_llm_identifiers_for_analysis(
            analysis_id, tier=tier, user_id=user_id,
            trace_sink=(_ident_calls if trace_runs_enabled() else None),
        )
        if n_ident:
            logger.info("llm identifiers wrote %d for job=%s", n_ident, job_id)
    except Exception:  # pragma: no cover — never fail a done analysis over this
        logger.warning("llm identifiers failed for job=%s", job_id, exc_info=True)

    # ── Phase C-trace — optional run-trace artifact (dev/opt-in; TRACE_RUNS) ──
    # Reconstructs the full decision flow (analysis → IDENTIFY → SOLVE) with the
    # full per-stage payloads + the captured LLM routing. Best-effort.
    if trace_runs_enabled():
        try:
            from .trace.generate import generate_run_trace  # noqa: PLC0415
            generate_run_trace(analysis_id, analysis_inputs={
                "file_path": file_rel,
                "reference_path": reference_path,
                "als_file_path": als_file_path,
                "stem_paths": stem_paths,
                "stem_mode": stem_mode,
                "defer_structure": True,
            }, llm_calls=_ident_calls)
        except Exception:  # pragma: no cover — never fail a done analysis over this
            logger.warning("run trace failed for job=%s", job_id, exc_info=True)

    # ── Phase D — kick off background structure detection (fill-in) ──────────
    # The fast phases are now persisted + the job is COMPLETE. Enqueue the heavy
    # allin1 step as its own job so Phase 7 fills in later (best-effort: a
    # failure here never undoes the successful analysis).
    # Story 4.5: anon (device-owned) jobs skip the structure follow-up — the
    # progress-vehicle AnalysisJob it creates is user-owned by shape, and the
    # anon funnel's report doesn't surface Phase 7 (6.3 revisits if needed).
    if version_id is not None and user_id is not None:
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

    # Phase A — read the staged entries (short tx; the fetch/classify below
    # can take minutes and MUST NOT hold a transaction — 3-phase rule).
    with SessionFactory.begin() as s:
        version = s.get(SongVersion, vid)
        if version is None:
            raise ValueError(f"version {version_id} not found")
        entries = list(version.stem_paths_raw or [])
        if not entries:
            logger.info("classify_stems: no staged stems for version=%s", version_id)
            return

    # Phase B — resolve (Story 3.2: presigned-staged stems are R2 keys;
    # local-first with S3 fetch fallback) + classify, outside any tx. The
    # finally covers partial fetches when resolve or classify fails mid-batch.
    fetched: list[Path] = []
    try:
        abs_paths: list[Path] = []
        for e in entries:
            local, f = object_store.resolve_local(str(e["path"]), LOCAL_ROOT)
            if f is not None:
                fetched.append(f)
            abs_paths.append(Path(local))
        # On-disk paths are UUIDs; pass the authoritative export name so the classifier
        # can keyword-match (Kick/Snare/Bass/...) before falling back to audio content.
        names = [e.get("original_filename") or Path(e["path"]).name for e in entries]
        proposals = classify_audio(abs_paths, names)
    finally:
        object_store.cleanup_all(fetched)

    updated = []
    for e, prop in zip(entries, proposals):
        ne = dict(e)
        ne["detected_role"] = prop.role.value
        ne["confidence"] = round(float(prop.confidence), 3)
        ne["evidence"] = prop.evidence
        updated.append(ne)

    # Phase C — write the proposals back (fresh short tx). Reassign so
    # SQLAlchemy flags the JSONB column dirty (in-place mutation isn't tracked).
    with SessionFactory.begin() as s:
        version = s.get(SongVersion, vid)
        if version is None:
            return
        version.stem_paths_raw = updated

    logger.info("classify_stems: done version=%s (%d stems)", version_id, len(entries))


def _render_and_store_images(job_id: str, file_abs: str) -> tuple[str | None, str | None]:
    """Render the result spectrogram + waveform and store them under LOCAL_ROOT.

    Keyed by ``job_id`` (``analysis/images/{job_id}/{kind}.webp``) so the BFF —
    whose ``IFileStorage`` resolves against the SAME ``data/`` root — can serve
    them by key. Best-effort: any render/IO failure is logged and swallowed so a
    completed analysis is never undone over a missing image (mirrors
    ``_try_write_artifact``). Returns ``(spectrogram_key, waveform_key)``; either
    is ``None`` when unavailable.
    """
    if render_analysis_images is None:
        return None, None
    try:
        images = render_analysis_images(file_abs)
        base = f"analysis/images/{job_id}"
        out_dir = Path(LOCAL_ROOT) / base
        out_dir.mkdir(parents=True, exist_ok=True)
        keys: dict[str, str] = {}
        for kind in ("spectrogram", "waveform"):
            data = images.get(kind)
            if not data:
                continue
            (out_dir / f"{kind}.webp").write_bytes(data)
            keys[kind] = f"{base}/{kind}.webp"
        return keys.get("spectrogram"), keys.get("waveform")
    except Exception:  # pragma: no cover — never fail a done analysis over an image
        logger.warning("image render failed for job=%s", job_id, exc_info=True)
        return None, None


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


def _try_upload_durables(
    job_id: str,
    result_dict: dict,
    spectrogram_key: str | None,
    waveform_key: str | None,
) -> None:
    """Story 3.3 (AC2/AR20) — durable copies in object storage, best-effort.

    ``reports/{jobId}.json`` is the AR20 durable report; the result images go
    up under their EXISTING local keys so the BFF's media routes (local-first,
    presigned-GET fallback) serve them unchanged in prod, where the worker box
    and the BFF box do not share a disk. The canonical report store remains
    ``analyses.final_json`` — failures here never fail a completed job.
    """
    if not object_store.s3_enabled():
        return
    try:
        object_store.put_json(f"reports/{job_id}.json", result_dict)
    except Exception:
        logger.warning("durable report upload failed job=%s (non-fatal)", job_id, exc_info=True)
    for key in (spectrogram_key, waveform_key):
        if not key:
            continue
        local = Path(LOCAL_ROOT) / key
        if not local.exists():
            continue
        try:
            object_store.put_file(key, local, content_type="image/webp")
        except Exception:
            logger.warning("image upload failed key=%s (non-fatal)", key, exc_info=True)
