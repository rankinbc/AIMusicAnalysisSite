"""Coach Mix orchestrator: problems -> solvers -> arbiter -> (LLM) -> compile."""
from __future__ import annotations

from typing import Any

from aimusic_shared.verdicts.models import Verdict

from app.coach_mix import arbiter, llm_arbiter
from app.solve_lib.preset_compiler import compile_preset
from app.solve_lib.router import merge


def synthesize(problems: list[Verdict], analysis: dict[str, Any], *, genre: str | None,
               tier: str, user_id: str | None, correlation_id: str) -> dict[str, Any]:
    candidates = [v for v in merge(problems, analysis, genre) if v.fix]
    result = arbiter.run(candidates, analysis, genre)
    result, notes, degraded = llm_arbiter.consult(
        result, analysis, genre, tier=tier, user_id=user_id, correlation_id=correlation_id)
    compiled = compile_preset(result.verdicts)
    return {
        "chain": compiled["chain"],
        "leftover_advice": compiled["leftover_advice"],
        "change_log": [*result.change_log, *compiled["change_log"]],
        "arbiter_notes": notes,
        "degraded": degraded,
    }
