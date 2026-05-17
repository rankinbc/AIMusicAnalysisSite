"""Reshape the v2 ``final_json`` into the flat key layout the legacy validator
expects.

The pipeline writes phases as a LIST::

    { "grade": "F", "phases": [{"phase": 1, "name": "...", "data": {...}}, ...], "coach_name": ... }

But the legacy specialist prompts + validator address metrics by dotted key
under flat ``phaseN`` entries::

    "phase1.lufs", "phase4.clashes[0].severity"

Without this flatten the validator would fail every metric path and the rule
engine silently produces zero verdicts (see project memory
``project_verdict_pipeline_shape_bug``).
"""
from __future__ import annotations

from typing import Any


def flatten(final_json: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of ``final_json`` with the ``phases`` list expanded into
    top-level ``phase1``…``phaseN`` keys.

    Original top-level keys (``grade``, ``coach_name``, ``overall_score``,
    ``danceability_score``, …) are preserved.
    """
    out: dict[str, Any] = {k: v for k, v in final_json.items() if k != "phases"}
    for p in final_json.get("phases") or []:
        if not isinstance(p, dict):
            continue
        n = p.get("phase")
        if n is None:
            continue
        out[f"phase{n}"] = p.get("data") or {}
    return out
