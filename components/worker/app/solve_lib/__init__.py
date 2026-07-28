"""Deterministic SOLVE tier: problems -> Fix -> rack chain.

``solve(problems, analysis)`` is the orchestrator: route + attach fixes (router),
then compile the de-suppressed, validated fixes into a Listen-rack ``chain``
(preset_compiler). No LLM, no Tier-B time-series — the composite-refiner and
stems/MIDI solvers are follow-ons.
"""
from __future__ import annotations

from typing import Any

from aimusic_shared.verdicts.models import Verdict

from app.solve_lib.preset_compiler import compile_preset
from app.solve_lib.router import merge

__all__ = ["solve", "compile_preset", "merge"]


def solve(problems: list[Verdict], analysis: dict[str, Any]) -> dict[str, Any]:
    """problems -> {"chain", "master_target", "targets", "leftover_advice",
    "change_log"}. ``chain`` is the master rack; ``targets`` carries one
    compiled chain per non-master target (per-stem instruction blocks)."""
    genre = (analysis.get("phase2") or {}).get("genre")
    return compile_preset(merge(problems, analysis, genre))
