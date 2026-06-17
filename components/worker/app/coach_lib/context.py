"""Coach context-bundle assembly + evidence-citation resolution (story 1.5).

The bundle is the entire grounding surface the coach sees: the flattened
analysis, top-N verdicts by priority, optional .als track-name attribution,
and the recent conversation tail. AR10: the coach answers ONLY from this
bundle; unresolvable citations are dropped server-side so the persisted
chip list always points to real measured values.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Iterable

from ..verdict_lib.input_grounding import grounding_preamble, input_provenance
from .payload import CoachEvidence

logger = logging.getLogger(__name__)

# Top-N verdicts to include (matches the legacy BFF coach cap of 40).
_VERDICT_CAP = 40
# Conversation tail cap — last 10 turns (≈ 5 Q/A pairs). Anything older is
# truncated; the coach gets enough continuity for short follow-ups but the
# prompt size stays bounded.
_TAIL_CAP = 10
# Keys lifted from the flattened analysis when present.
_ALS_KEYS = ("als_summary", "als_track_names", "als")


# ── public API ──────────────────────────────────────────────────────────────

def build_context_bundle(
    *,
    flattened_analysis: dict[str, Any],
    verdicts: Iterable[dict[str, Any]],
    conversation_tail: Iterable[dict[str, Any]],
) -> dict[str, Any]:
    """Pure builder. Inputs come pre-loaded from the actor's Phase A; this
    function does no DB I/O so it stays unit-testable without a session.

    - ``flattened_analysis`` — output of ``verdict_lib.flatten_analysis.flatten``.
      The coach sees the same shape the specialists see.
    - ``verdicts`` — list of dicts with at least ``specialist, severity,
      category, headline, summary, metric_line, priority_score``. Already
      ownership-filtered upstream.
    - ``conversation_tail`` — list of dicts ``{role, body}`` in ASC order;
      caller passes earlier-pre-filtered rows (no pending, capped to the
      most recent N before this slice).

    Returns a plain JSON-safe dict.
    """
    top_verdicts = sorted(
        (v for v in verdicts if v is not None),
        key=lambda v: int(v.get("priority_score") or 0),
        reverse=True,
    )[:_VERDICT_CAP]

    als_summary: Any = None
    for k in _ALS_KEYS:
        if k in flattened_analysis and flattened_analysis[k]:
            als_summary = flattened_analysis[k]
            break

    tail = list(conversation_tail)
    if len(tail) > _TAIL_CAP:
        tail = tail[-_TAIL_CAP:]

    return {
        "analysis": flattened_analysis,
        "verdicts": top_verdicts,
        "als_summary": als_summary,
        "conversation_tail": tail,
        # AR10 grounding: authoritative truth of which inputs the user actually
        # provided. The flattened analysis carries skipped/failed phase-4/5
        # scaffolding that a live model otherwise narrates as real stems / a
        # reference track. The coach must honor this over the raw JSON.
        "inputs_provided": input_provenance(flattened_analysis),
        "input_grounding": grounding_preamble(flattened_analysis),
    }


# ── citation resolution ────────────────────────────────────────────────────

# A JSON-pointer-ish path: dotted segments with optional ``[N]`` array
# subscripts (e.g. ``phase4.clashes[0].severity``). The coach prompt is
# steered to emit this syntax — anything else fails to resolve and the
# chip drops.
_PATH_SEGMENT_RE = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+)\])?")


def resolve_evidence(
    evidence: Iterable[CoachEvidence],
    context_bundle: dict[str, Any],
) -> list[CoachEvidence]:
    """Keep only chips whose ``path`` resolves to a non-null value in the
    bundle. Unresolvable paths are dropped + logged (AR10). NEVER raises —
    a malformed path is a prompt bug, not a job failure.

    ``label`` is preserved verbatim — it's the rendered text on the chip;
    we don't second-guess the model's choice of label so long as the
    backing path resolves.
    """
    kept: list[CoachEvidence] = []
    for chip in evidence:
        try:
            value = _resolve_path(chip.path, context_bundle)
        except Exception:  # noqa: BLE001 — never raise out of citation resolution
            logger.info("coach evidence chip path raised (dropped): %s", chip.path)
            continue
        if value is None:
            logger.info("coach evidence chip path unresolved (dropped): %s", chip.path)
            continue
        kept.append(chip)
    return kept


def _resolve_path(path: str, bundle: dict[str, Any]) -> Any:
    """Walk a dotted/array path against ``bundle``. Returns the resolved
    value or ``None``. The bundle's top-level keys (``analysis``,
    ``verdicts``, ``als_summary``, ``conversation_tail``) are the entry
    points; legacy chip paths like ``phase1.lufs_integrated`` are rewritten
    to ``analysis.phase1.lufs_integrated`` so the model doesn't have to
    know about the bundle wrapper.
    """
    if not path:
        return None
    # Rewrite legacy specialist-style paths (phaseN.…, verdicts[…], …) so
    # they look up under the bundle's known top-level keys.
    if path.startswith("phase") or path.startswith("grade") \
            or path.startswith("coach_") or path.startswith("danceability") \
            or path.startswith("overall"):
        path = f"analysis.{path}"

    current: Any = bundle
    for raw in path.split("."):
        if current is None:
            return None
        m = _PATH_SEGMENT_RE.fullmatch(raw)
        if not m:
            return None
        key = m.group(1)
        idx = m.group(2)
        if not isinstance(current, dict):
            return None
        current = current.get(key)
        if idx is not None:
            if not isinstance(current, list):
                return None
            i = int(idx)
            if i < 0 or i >= len(current):
                return None
            current = current[i]
    return current
