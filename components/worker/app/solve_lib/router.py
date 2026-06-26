"""Router — the IDENTIFY -> SOLVE bridge (deterministic core).

Suppression (router.md Stage 1a) already happened in ``evaluate_problems``; the
LLM refine stage (1b) is out of scope. This module does Stage 2 (route) and
Stage 4 (merge); fan-out (Stage 3) is a single-solver no-op for the audio_only
MVP (multi-domain fan-out unlocks with stems).

``route`` maps ``(category, data_tier)`` -> a solver name (or None when no
master-rack move applies). ``merge`` runs each routed solver, validates the
resulting Fix, and attaches it to the problem; everything else passes through
with ``fix=None``.
"""
from __future__ import annotations

from typing import Any

from aimusic_shared.verdicts.models import Verdict

from app.solve_lib.solvers import SOLVERS
from app.verdict_lib.validator import validate_verdict

# (category, data_tier) -> solver name. MVP = audio_only master-rack moves.
ROUTE_TABLE: dict[tuple[str, str], str] = {
    ("clipping", "audio_only"): "clipping",
    ("loudness", "audio_only"): "loudness",
    ("frequency_balance", "audio_only"): "frequency_balance",
    ("low_end", "audio_only"): "low_end",
    ("stereo_field", "audio_only"): "stereo_field",
}


def route(v: Verdict) -> str | None:
    """Solver name for this problem, or None (observation / unmapped tier)."""
    if not v.fixable:
        return None
    return ROUTE_TABLE.get((v.category, v.data_tier))


def merge(problems: list[Verdict], analysis: dict[str, Any], genre: str | None) -> list[Verdict]:
    """Attach a validated Fix to every routed problem; pass the rest through."""
    out: list[Verdict] = []
    for v in problems:
        name = route(v)
        if name is None:
            out.append(v)
            continue
        fix = SOLVERS[name](v, analysis, genre)
        if fix is None:
            out.append(v)  # solver declined -> unsolved
            continue
        candidate = v.model_copy(update={"fix": fix})
        result = validate_verdict(candidate, analysis)
        # validate normalizes severity/priority and keeps the fix; drop the fix
        # only if the candidate is rejected outright.
        out.append(result.verdict if result.ok and result.verdict is not None else v)
    return out
