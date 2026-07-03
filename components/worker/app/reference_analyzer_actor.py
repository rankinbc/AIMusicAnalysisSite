"""Dramatiq actor: analyze a saved reference track and persist metrics.

Wire format (1 string arg, matches the BFF's DramatiqJobQueue envelope):

    run_reference_analyzer(reference_id: str)

Lifecycle:

  A. Load ReferenceTrack row. Bail if file_path missing or already analyzed.
  B. Stream the audio file from storage to a temp path so audio_analysis can
     decode it.
  C. Run phase1 (universal mix analysis) — gives us LUFS, true peak, BPM,
     key, stereo width/correlation, band levels.
  D. UPDATE reference_tracks with the metrics and analyzed=true.

The reference is a single-shot read-only analysis; no LLM, no verdict
pipeline. Failures persist `analyzed=false` so a future re-enqueue can retry.
"""
from __future__ import annotations

import json
import logging
import os
import uuid

import dramatiq

from aimusic_shared.models import ReferenceTrack
from audio_analysis.phases import phase1_universal

from . import object_store
from .db_sync import SessionFactory

logger = logging.getLogger(__name__)


@dramatiq.actor(
    actor_name="run_reference_analyzer",
    queue_name="analysis-paid",  # story 2.5: low-volume secondary op → W1
    max_retries=1,
    time_limit=180_000,  # 3 minutes — reference tracks are typically 3-6 min
)
def run_reference_analyzer(reference_id: str) -> None:
    """See module docstring."""
    rid = uuid.UUID(reference_id)
    logger.info("run_reference_analyzer start reference=%s", reference_id)

    # ── A: load row ────────────────────────────────────────────────────────
    try:
        with SessionFactory.begin() as s:
            ref = s.get(ReferenceTrack, rid)
            if ref is None:
                logger.warning("reference %s not found", reference_id)
                return
            file_path = ref.file_path
            if not file_path:
                logger.warning("reference %s has no file_path", reference_id)
                return
    except Exception:
        logger.exception("Phase A failed for reference=%s", reference_id)
        return

    # ── B: resolve local path ──────────────────────────────────────────────
    # The BFF writes references under `audio/reference/{id}/source{ext}`.
    # Story 3.2: local-first against the storage root, S3/R2 fetch fallback
    # for presigned-uploaded references (object_store.resolve_local).
    storage_root = os.environ.get("FILE_STORAGE_ROOT", "/app/storage")
    try:
        local_path, fetched = object_store.resolve_local(file_path, storage_root)
    except Exception:
        # Best-effort actor (pre-3.2 behavior was log-and-bail): a failed S3
        # fetch must not put the reference row into a retry storm.
        logger.exception("reference %s remote fetch failed", reference_id)
        return
    if not os.path.exists(local_path):
        logger.warning(
            "reference %s file %s not found locally and S3 fetch unavailable",
            reference_id, local_path,
        )
        return

    # ── C: run phase 1 ─────────────────────────────────────────────────────
    try:
        # Phase 1 expects a path string + optional progress callback.
        result = phase1_universal.analyze(local_path)
    except Exception as exc:
        logger.exception("phase1 failed for reference=%s: %s", reference_id, exc)
        _mark_failed(rid, str(exc))
        return
    finally:
        object_store.cleanup_local(fetched)

    data = result.get("data") if isinstance(result, dict) else None
    if not isinstance(data, dict):
        logger.warning("phase1 produced no data for reference=%s", reference_id)
        _mark_failed(rid, "phase1 produced no data")
        return

    # ── D: persist metrics ─────────────────────────────────────────────────
    try:
        with SessionFactory.begin() as s:
            ref = s.get(ReferenceTrack, rid)
            if ref is None:
                return
            ref.bpm = _maybe_float(data.get("bpm"))
            ref.detected_key = _maybe_str(data.get("detected_key"))
            ref.duration_seconds = _maybe_float(data.get("duration_seconds"))
            ref.lufs = _maybe_float(data.get("lufs"))
            ref.true_peak_db = _maybe_float(
                data.get("true_peak_db") or data.get("peak_dbfs")
            )
            ref.stereo_width = _maybe_float(data.get("stereo_width"))
            ref.stereo_correlation = _maybe_float(data.get("stereo_correlation"))
            # Dynamic range: |rms - lufs| (LU). Keep it derived rather than
            # storing it raw so the convention matches the report UI.
            rms = _maybe_float(data.get("rms"))
            if rms is not None and ref.lufs is not None:
                ref.dynamic_range_lu = abs(rms - ref.lufs)
            bands = data.get("bands")
            if isinstance(bands, dict):
                ref.band_levels = json.dumps(bands)
            ref.analyzed = True
            ref.analysis_status = "analyzed"
            ref.analysis_error = None
    except Exception as exc:
        logger.exception("persist failed for reference=%s", reference_id)
        _mark_failed(rid, str(exc))
        return

    logger.info("run_reference_analyzer done reference=%s", reference_id)


def _mark_failed(rid: uuid.UUID, error: str) -> None:
    """Persist a `failed` status marker so the UI can show a Retry. Best-effort —
    never raises (mirrors run_specialist's fail-marker)."""
    try:
        with SessionFactory.begin() as s:
            ref = s.get(ReferenceTrack, rid)
            if ref is None:
                return
            ref.analysis_status = "failed"
            ref.analysis_error = (error or "")[:500]
            ref.analyzed = False
    except Exception:
        logger.exception("could not persist fail marker for reference=%s", rid)


def _maybe_float(v) -> float | None:
    return float(v) if isinstance(v, (int, float)) else None


def _maybe_str(v) -> str | None:
    return v if isinstance(v, str) and v else None
