"""Per-phase partial results for the live analysis page.

``analyze_audio_job`` merges each phase's result slice + duration into
``analysis_jobs.partial_json`` as the pipeline produces it, so the frontend's
job poll can fill the step list (and the coach's narration) live instead of
waiting for ``analyses.final_json`` at the very end.

Shape (versioned with ``v`` so the frontend can tolerate future changes)::

    {
      "v": 1,
      "phases":  {"<n>": {"name", "status", "seconds", "data", "error"}},
      "early":   {"1": {"lufs", "true_peak_db", "bpm", "detected_key", ...}},
      "running": {"phase": n, "name": str, "started_at": iso8601}
    }

Everything here is display-only and best-effort: the merge helpers are pure,
and :func:`make_recorder`'s writers swallow every error — a live-progress
write must never fail (or slow down) the analysis itself.
"""
from __future__ import annotations

import json
import logging
import math
from datetime import datetime
from typing import Any, Callable

PARTIAL_VERSION = 1

# Heavy per-sample series the live page never shows — dropped outright.
_DROP_KEYS = {"loudness_timeline", "beats", "downbeats", "segments", "spectrum", "waveform"}
_MAX_DEPTH = 5
_MAX_SCALAR_LIST = 16
_MAX_DICT_LIST = 8
_MAX_STR = 400
# Sentinel: "leave this value out entirely" (vs. a real JSON null).
_OMIT = object()


def _slim(value: Any, depth: int = 0) -> Any:
    """JSON-safe, size-bounded copy of a phase's data for the job poll.

    Long numeric series are dropped, lists of objects truncated, and
    non-finite floats nulled (Postgres JSONB rejects NaN/Infinity)."""
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, str):
        return value[:_MAX_STR]
    if isinstance(value, dict):
        if depth >= _MAX_DEPTH:
            return _OMIT
        out = {}
        for k, v in value.items():
            if k in _DROP_KEYS:
                continue
            sv = _slim(v, depth + 1)
            if sv is not _OMIT:
                out[str(k)] = sv
        return out
    if isinstance(value, list):
        if depth >= _MAX_DEPTH:
            return _OMIT
        if all(not isinstance(v, (dict, list)) for v in value):
            if len(value) > _MAX_SCALAR_LIST:
                return _OMIT
            items = value
        else:
            items = value[:_MAX_DICT_LIST]
        return [x for x in (_slim(v, depth + 1) for v in items) if x is not _OMIT]
    return value


def _json_safe(value: Any) -> Any:
    # Round-trip first so numpy scalars / TypedDicts become plain JSON types —
    # and so the stored slice never aliases the live pipeline result.
    return json.loads(json.dumps(value, default=str))


def slim_data(value: Any) -> Any:
    out = _slim(_json_safe(value))
    return None if out is _OMIT else out


def _base(partial: Any) -> dict:
    cur = dict(partial) if isinstance(partial, dict) else {}
    cur["v"] = PARTIAL_VERSION
    return cur


def merge_phase(partial: Any, phase: int, name: str, result: Any, seconds: float) -> dict:
    """Fold a finished phase (a PhaseResult-shaped dict) into *partial*."""
    cur = _base(partial)
    phases = dict(cur.get("phases") or {})
    res = result if isinstance(result, dict) else {}
    phases[str(phase)] = {
        "name": name,
        "status": res.get("status", "ok"),
        "seconds": round(float(seconds), 2),
        "data": slim_data(res.get("data") or {}),
        "error": (str(res["error"])[:_MAX_STR] if res.get("error") else None),
    }
    cur["phases"] = phases
    return cur


def merge_early(partial: Any, phase: int, data: Any) -> dict:
    """Fold an interim sub-result (e.g. phase-1 LUFS) into ``early[phase]``."""
    cur = _base(partial)
    early = dict(cur.get("early") or {})
    slot = dict(early.get(str(phase)) or {})
    slim = slim_data(data)
    if isinstance(slim, dict):
        slot.update(slim)
    early[str(phase)] = slot
    cur["early"] = early
    return cur


def merge_running(partial: Any, phase: int, name: str, started_at: datetime) -> dict:
    """Record which phase just started (and when) for the live step clock."""
    cur = _base(partial)
    cur["running"] = {"phase": phase, "name": name, "started_at": started_at.isoformat()}
    return cur


def make_phase_recorder(
    session_factory: Callable[[], Any],
    job_model: type,
    job_id: Any,
    log: logging.Logger,
) -> Callable[..., None]:
    """Build the pipeline's ``phase_done_cb`` for one job.

    Each call is its own short transaction (same pattern as the actor's
    ``_report_progress``) and never raises."""

    def phase_done_cb(phase: int, name: str, data: Any, seconds: float | None) -> None:
        try:
            with session_factory() as s:
                job = s.get(job_model, job_id)
                if job is not None:
                    # Reassign (never mutate in place) so SQLAlchemy sees the change.
                    if seconds is None:
                        job.partial_json = merge_early(job.partial_json, phase, data)
                    else:
                        job.partial_json = merge_phase(job.partial_json, phase, name, data, seconds)
        except Exception:  # live results are best-effort — never fail the job
            log.warning("partial_json write failed (phase=%s)", phase, exc_info=True)

    return phase_done_cb
