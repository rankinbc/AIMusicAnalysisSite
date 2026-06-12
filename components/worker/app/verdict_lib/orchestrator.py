from __future__ import annotations
import logging
from dataclasses import dataclass
from typing import Any, AsyncIterator, Literal

from aimusic_shared.verdicts.models import SpecialistRoutingPlan, Verdict

from .dedupe import dedupe_verdicts
from .llm_protocol import LLMCaller
from .ranker import rank_verdicts
from .rule_engine import evaluate_rules
from .specialists import run_specialists
from .triage import run_triage
from .validator import (
    validate_verdict,
)

log = logging.getLogger(__name__)


EventKind = Literal[
    "rule-verdict", "routing-plan", "verdict",
    "validation-failure", "specialist-error", "complete",
]


@dataclass
class PipelineEvent:
    kind: EventKind
    payload: dict[str, Any]


async def run_pipeline(
    analysis: dict[str, Any],
    *,
    llm: LLMCaller,
    model_name: str = "claude-cli",
    timeout_s: int = 90,
) -> AsyncIterator[PipelineEvent]:
    """End-to-end verdict pipeline. Yields PipelineEvent objects in order:

    1. One `rule-verdict` per rule-engine output
    2. One `routing-plan`
    3. Many `verdict` (one per validated, kept specialist verdict — pre-dedupe)
       interleaved with `validation-failure` and `specialist-error` events
    4. One `complete` event with the full ranked + deduped final list
    """
    # 1. Rules
    rule_verdicts: list[Verdict] = evaluate_rules(analysis)
    validated_rules: list[Verdict] = []
    for rv in rule_verdicts:
        result = validate_verdict(rv, analysis)
        if result.ok and result.verdict is not None:
            validated_rules.append(result.verdict)
            yield PipelineEvent(
                kind="rule-verdict", payload=result.verdict.model_dump(mode="json")
            )
        else:
            log.warning("rule-engine verdict failed validation: %s",
                        result.failure.reason if result.failure else "unknown")

    # 2. Triage
    try:
        plan: SpecialistRoutingPlan = await run_triage(
            analysis, rule_verdicts=validated_rules, llm=llm, timeout_s=timeout_s,
        )
    except Exception as e:
        log.error("triage failed: %s", e)
        plan = SpecialistRoutingPlan(
            specialists_to_run=[],
            skip=[],
            rationale=f"triage failed: {e}",
            estimated_total_tokens=0,
        )
    yield PipelineEvent(kind="routing-plan", payload=plan.model_dump(mode="json"))

    # 3. Specialists
    specialist_verdicts: list[Verdict] = []
    async for slug, item in run_specialists(
        plan, analysis, llm=llm, model_name=model_name, timeout_s=timeout_s,
    ):
        if isinstance(item, Exception):
            yield PipelineEvent(
                kind="specialist-error",
                payload={"specialist": slug, "error": str(item)},
            )
            continue
        result = validate_verdict(item, analysis)
        if not result.ok and result.failure is not None:
            yield PipelineEvent(
                kind="validation-failure",
                payload={
                    "specialist": result.failure.specialist,
                    "prompt_version": result.failure.prompt_version,
                    "reason": result.failure.reason,
                },
            )
            continue
        assert result.verdict is not None
        specialist_verdicts.append(result.verdict)
        yield PipelineEvent(
            kind="verdict", payload=result.verdict.model_dump(mode="json")
        )

    # 4. Dedupe + rank → complete
    merged = dedupe_verdicts(validated_rules + specialist_verdicts)
    ranked = rank_verdicts(merged)
    yield PipelineEvent(
        kind="complete",
        payload={
            "verdicts": [v.model_dump(mode="json") for v in ranked],
            "verdict_count": len(ranked),
            "prompt_versions": _collect_prompt_versions(ranked),
            "model": model_name,
        },
    )


def _collect_prompt_versions(verdicts: list[Verdict]) -> str:
    """Comma-separated stable list of `<specialist>@<version>` for cache keying."""
    versions = sorted({v.prompt_version for v in verdicts})
    return ",".join(versions)
