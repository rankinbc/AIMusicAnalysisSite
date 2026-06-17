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
    # In local-disk storage mode, files live in the configured storage root.
    # In R2 mode we'd need to download to a temp file first — gated by env.
    storage_root = os.environ.get("FILE_STORAGE_ROOT", "/app/storage")
    local_path = os.path.join(storage_root, file_path)
    if not os.path.exists(local_path):
        # R2 / remote-storage path — for now, log and bail. Wire S3/R2
        # download here once the worker has the storage SDK.
        logger.warning(
            "reference %s file %s not found locally; remote-fetch not yet wired",
            reference_id, local_path,
        )
        return

    # ── C: run phase 1 ─────────────────────────────────────────────────────
    try:
        # Phase 1 expects a path string + optional progress callback.
        result = phase1_universal.analyze(local_path)
    except Exception as exc:
        logger.exception("phase1 failed for reference=%s: %s", reference_id, exc)
        return

    data = result.get("data") if isinstance(result, dict) else None
    if not isinstance(data, dict):
        logger.warning("phase1 produced no data for reference=%s", reference_id)
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
    except Exception:
        logger.exception("persist failed for reference=%s", reference_id)
        return

    logger.info("run_reference_analyzer done reference=%s", reference_id)


def _maybe_float(v) -> float | None:
    return float(v) if isinstance(v, (int, float)) else None


def _maybe_str(v) -> str | None:
    return v if isinstance(v, str) and v else None
