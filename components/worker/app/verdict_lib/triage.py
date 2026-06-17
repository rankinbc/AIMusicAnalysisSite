from __future__ import annotations
from typing import Any

from aimusic_shared.verdicts.models import SpecialistRoutingPlan, Verdict

from .input_grounding import als_state, build_triage_user_message
from .json_extraction import extract_json_object
from .llm_protocol import LLMCaller
from .prompt_loader import load_triage

# Specialists that require the authoritative .als project map to operate. When no
# .als is present they have nothing to ground on, so they are stripped from the
# routing plan — mirrors the prompt rule "do NOT route stem specialists when stems
# are absent" (see Triage.md). Kept intentionally minimal: only the device-chain
# specialist strictly needs the track/device map.
_ALS_ONLY_SPECIALISTS: frozenset[str] = frozenset({"device_chain"})


def gate_als_specialists(
    plan: SpecialistRoutingPlan, analysis: dict[str, Any]
) -> SpecialistRoutingPlan:
    """Strip .als-only specialists from *plan* when no .als project map is present.

    No-op when an .als is present (``als_state == "ok"``) — the plan is returned
    unchanged so an .als project keeps its device-chain advice. When absent, any
    ``_ALS_ONLY_SPECIALISTS`` entry is moved from ``specialists_to_run`` to ``skip``
    so the routing plan still records the decision. This keeps the no-.als path
    byte-identical to today (those specialists were never meant to run there)."""
    if als_state(analysis) == "ok":
        return plan
    kept = [s for s in plan.specialists_to_run if s.get("name") not in _ALS_ONLY_SPECIALISTS]
    if len(kept) == len(plan.specialists_to_run):
        return plan
    dropped = [
        s["name"]
        for s in plan.specialists_to_run
        if s.get("name") in _ALS_ONLY_SPECIALISTS
    ]
    return plan.model_copy(
        update={
            "specialists_to_run": kept,
            "skip": list(plan.skip) + dropped,
        }
    )


async def run_triage(
    analysis: dict[str, Any],
    *,
    rule_verdicts: list[Verdict],
    llm: LLMCaller,
    timeout_s: int = 90,
) -> SpecialistRoutingPlan:
    """Call the Triage prompt; parse and return SpecialistRoutingPlan.

    Raises ValueError if the LLM output cannot be parsed into a valid plan.
    The caller (orchestrator) decides whether to retry or fall back.
    """
    _, system_body = load_triage()
    user = build_triage_user_message(analysis, rule_verdicts)
    raw = await llm.call(system=system_body, user=user, timeout_s=timeout_s)
    obj = extract_json_object(raw)
    return gate_als_specialists(SpecialistRoutingPlan(**obj), analysis)
