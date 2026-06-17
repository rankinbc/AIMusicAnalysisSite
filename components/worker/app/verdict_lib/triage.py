from __future__ import annotations
from typing import Any

from aimusic_shared.verdicts.models import SpecialistRoutingPlan, Verdict

from .input_grounding import build_triage_user_message
from .json_extraction import extract_json_object
from .llm_protocol import LLMCaller
from .prompt_loader import load_triage


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
    return SpecialistRoutingPlan(**obj)
