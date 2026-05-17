"""Dramatiq actor: run Triage on one analysis and persist the routing plan.

Wire format (1 string arg, matches the BFF's DramatiqJobQueue envelope):

    run_triage(analysis_id: str)

Lifecycle:

  A. Load Analysis. Bail if ``routing_plan`` is already set (idempotent).
  B. Flatten ``final_json`` for prompt compatibility.
  C. Load the Triage prompt.
  D. Call claude CLI synchronously.
  E. Parse + validate against ``SpecialistRoutingPlan`` schema.
  F. UPDATE ``analyses.routing_plan = <plan>`` WHERE column IS NULL.

The Triage prompt produces:
    {
      "specialists_to_run": [{"name": "<slug>", "priority": <int>, "focus": "..."}],
      "skip": ["<slug>", ...],
      "rationale": "...",
      "estimated_total_tokens": <int>
    }

We don't write a fail-marker on failure — the column just stays NULL and the
BFF can re-enqueue on the next ListVerdicts call.
"""
from __future__ import annotations

import json
import logging
import uuid
from typing import Any

import dramatiq

from aimusic_shared.models import Analysis
from aimusic_shared.verdicts.models import SpecialistRoutingPlan

from .db_sync import SessionFactory
from .verdict_lib.flatten_analysis import flatten
from .verdict_lib.json_extraction import extract_json_object
from .verdict_lib.llm_client_sync import (
    LLMInvocationError,
    LLMTimeoutError,
    llm_call_sync,
)
from .verdict_lib.prompt_loader import load_triage

logger = logging.getLogger(__name__)


def _build_user_message(analysis: dict[str, Any]) -> str:
    # Triage doesn't see rule-engine findings in the worker path — the
    # legacy api orchestrator passes them in, but the BFF lazy-fire path
    # never runs the rule engine. Triage's prompt accepts an empty list.
    payload = {
        "analysis": analysis,
        "rule_engine_findings": [],
    }
    return (
        "Triage this mix.\n\n"
        f"```json\n{json.dumps(payload, indent=2, default=str)}\n```\n\n"
        "Return only the routing-plan JSON object."
    )


@dramatiq.actor(
    actor_name="run_triage",
    queue_name="default",
    max_retries=1,
    time_limit=180_000,  # 3 minutes
)
def run_triage(analysis_id: str) -> None:
    """See module docstring."""
    aid = uuid.UUID(analysis_id)
    logger.info("run_triage start analysis=%s", analysis_id)

    # ── A: load + idempotency check ────────────────────────────────────────
    try:
        with SessionFactory.begin() as s:
            analysis = s.get(Analysis, aid)
            if analysis is None:
                logger.warning("run_triage: analysis %s not found", analysis_id)
                return
            if analysis.routing_plan is not None:
                logger.info("run_triage: %s already has routing_plan, skipping",
                            analysis_id)
                return
            raw_final = analysis.final_json
    except Exception:
        logger.exception("run_triage Phase A failed for %s", analysis_id)
        return

    flattened = flatten(raw_final if isinstance(raw_final, dict) else {})

    # ── C: load prompt ─────────────────────────────────────────────────────
    try:
        _version, prompt_body = load_triage()
    except (KeyError, FileNotFoundError):
        logger.exception("run_triage: triage prompt missing")
        return

    # ── D: LLM call ────────────────────────────────────────────────────────
    user_msg = _build_user_message(flattened)
    try:
        raw_text = llm_call_sync(system=prompt_body, user=user_msg, timeout_s=120)
    except (LLMTimeoutError, LLMInvocationError) as exc:
        logger.info("run_triage: LLM call failed for %s: %s", analysis_id, exc)
        return

    # ── E: parse + validate ────────────────────────────────────────────────
    try:
        obj = extract_json_object(raw_text)
        plan = SpecialistRoutingPlan(**obj)
    except (ValueError, Exception) as exc:
        logger.info("run_triage: invalid plan for %s: %s", analysis_id, exc)
        return

    # ── F: persist (idempotent — only write if still NULL) ─────────────────
    plan_json = plan.model_dump(mode="json")
    try:
        with SessionFactory.begin() as s:
            row = s.get(Analysis, aid)
            if row is None or row.routing_plan is not None:
                return
            row.routing_plan = plan_json
    except Exception:
        logger.exception("run_triage: persist failed for %s", analysis_id)
        return

    logger.info(
        "run_triage done analysis=%s specialists=%d skip=%d",
        analysis_id, len(plan.specialists_to_run), len(plan.skip),
    )
