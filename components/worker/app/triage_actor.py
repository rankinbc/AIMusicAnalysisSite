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

Terminal failures (budget, LLM error, invalid plan) write the degradation
notice + rule-engine findings; ``routing_plan`` stays NULL but the BFF's
DegradationNotice guard stops re-enqueuing (E5.3 — previously every
ListVerdicts call dispatched another LLM attempt, unbounded spend). Only the
transient Phase A/C failures (DB blip, prompt missing) still bare-return so
the next ListVerdicts can retry.
"""
from __future__ import annotations

import logging
import uuid

import dramatiq

from aimusic_shared.models import Analysis
from aimusic_shared.verdicts.models import SpecialistRoutingPlan

from . import obs
from .db_sync import SessionFactory
from .llm import gateway
from .llm.gateway import LlmBudgetExceeded, LlmError
from .verdict_lib.degraded import (
    run_rule_engine_for_analysis,
    write_degradation_notice,
)
from .verdict_lib.flatten_analysis import flatten
from .verdict_lib.input_grounding import build_triage_user_message
from .verdict_lib.json_extraction import extract_json_object
from .verdict_lib.prompt_loader import load_triage, load_triage_model

logger = logging.getLogger(__name__)


@dramatiq.actor(
    actor_name="run_triage",
    queue_name="analysis-paid",  # story 2.5: interactive LLM work → W1
    max_retries=1,
    time_limit=180_000,  # 3 minutes
)
def run_triage(analysis_id: str) -> None:
    """See module docstring."""
    aid = uuid.UUID(analysis_id)
    obs.set_correlation(analysis_id)
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
            if analysis.degradation_notice is not None:
                # Story 1.4: a prior call already stamped the degradation
                # notice (and rule-engine verdicts). A dramatiq retry or BFF
                # race could re-dispatch this actor; skipping here avoids
                # burning another LLM call only to re-trip the same exception
                # OR worse, succeeding (after recovery) and leaving the
                # analysis with both a routing_plan AND a degradation banner.
                logger.info(
                    "run_triage: %s already has degradation_notice, skipping",
                    analysis_id,
                )
                return
            raw_final = analysis.final_json
            caller_id = analysis.user_id  # for the metering row
            # cross-lane trace stitch (getattr: test stubs omit the column)
            obs.set_tag("job_id", getattr(analysis, "job_id", None))
    except Exception:
        logger.exception("run_triage Phase A failed for %s", analysis_id)
        return

    flattened = flatten(raw_final if isinstance(raw_final, dict) else {})

    # ── C: load prompt ─────────────────────────────────────────────────────
    try:
        triage_version, prompt_body = load_triage()
    except (KeyError, FileNotFoundError):
        logger.exception("run_triage: triage prompt missing")
        return

    # ── D: LLM call (via the metered gateway) ──────────────────────────────
    user_msg = build_triage_user_message(flattened)
    try:
        result = gateway.complete_sync(
            system=prompt_body,
            user=user_msg,
            purpose="triage",
            prompt_slug="triage",
            prompt_version=triage_version,
            model=load_triage_model(),  # None → gateway default
            user_id=caller_id,
            correlation_id=analysis_id,
            timeout_s=120,
        )
    except LlmBudgetExceeded as exc:
        # Story 1.4 / FR16: budget exhausted OR provider outage tripped the
        # circuit breaker. Persist the machine-readable notice + rule-engine
        # verdicts so the user gets actionable findings + a clear banner
        # instead of a silent empty report.
        logger.info(
            "run_triage: degradation triggered for %s (reason=%s)",
            analysis_id, exc.reason,
        )
        write_degradation_notice(aid, reason=exc.reason, detail=exc.detail)
        run_rule_engine_for_analysis(aid)
        return
    except LlmError as exc:
        # E5.3: a bare return here left routing_plan AND degradation_notice
        # NULL, so every ListVerdicts re-enqueued another LLM call — unbounded
        # spend. Terminal LLM failure now degrades exactly like budget
        # exhaustion: notice + rule-engine findings, and the BFF's
        # DegradationNotice guard stops all future enqueues.
        logger.info("run_triage: LLM call failed for %s: %s", analysis_id, exc)
        write_degradation_notice(aid, reason="triage_failed", detail=str(exc)[:500])
        run_rule_engine_for_analysis(aid)
        return

    # ── E: parse + validate ────────────────────────────────────────────────
    try:
        obj = extract_json_object(result.text)
        plan = SpecialistRoutingPlan(**obj)
    except Exception as exc:  # noqa: BLE001 — any parse/validation failure → skip
        # E5.3: same terminal-degradation treatment as the LlmError branch.
        logger.info("run_triage: invalid plan for %s: %s", analysis_id, exc)
        write_degradation_notice(aid, reason="triage_failed", detail=str(exc)[:500])
        run_rule_engine_for_analysis(aid)
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
