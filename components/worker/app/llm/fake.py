"""``LLM_FAKE=1`` deterministic replay (AR41).

Returns canned, schema-valid response TEXT keyed by purpose + prompt slug —
zero network, zero spend. No ``anthropic`` import.

Specialist responses use empty ``evidence`` and no ``fix`` so they survive
``validator.validate_verdict`` against ANY analysis (the validator only
rejects evidence whose metric path fails to resolve; with no evidence there
is nothing to resolve). Triage returns a minimal valid routing plan.
"""
from __future__ import annotations

import json


def _fake_specialist_text(slug: str) -> str:
    return json.dumps({
        "verdicts": [{
            "severity": "moderate",
            "category": "overall",
            "confidence": 0.7,
            "headline": f"[FAKE] {slug} placeholder verdict",
            "summary": "Synthetic verdict produced by LLM_FAKE replay.",
            "why_it_matters": "Lets the pipeline run end-to-end with zero spend.",
            "evidence": [],
            "fix": None,
        }],
    })


def _fake_triage_text() -> str:
    # Empty specialist list = valid plan that routes nothing; keeps fake runs
    # cheap and deterministic. Widen if a test needs routed specialists.
    return json.dumps({
        "specialists_to_run": [],
        "skip": [],
        "rationale": "[FAKE] LLM_FAKE replay — no specialists routed.",
        "estimated_total_tokens": 0,
    })


def _fake_coach_text() -> str:
    """Story 1.5 code review E-H3: without this branch the coach actor
    received specialist-shaped JSON in ``LLM_FAKE=1`` mode, the Pydantic
    schema rejected it, and every coach reply persisted as
    ``status="error"`` — breaking AR41's end-to-end-with-zero-spend
    guarantee for the dev/CI default.

    The fake answer carries NO evidence chip (an answer with an unresolved
    chip would be dropped by ``resolve_evidence`` anyway; an empty chip
    list keeps the body honest about being a placeholder). The body is
    intentionally numeric-free so the
    ``answer_makes_numeric_claim_without_evidence`` heuristic doesn't
    demote it.
    """
    return json.dumps({
        "kind": "answer",
        "body": (
            "[FAKE] LLM_FAKE replay — this is a placeholder coach reply for "
            "local development. Real answers cite measured values from your "
            "analysis."
        ),
        "evidence": [],
        "refusal_reason": None,
    })


def fake_response_text(*, purpose: str, prompt_slug: str | None) -> str:
    """Canned response text for one fake call."""
    if purpose == "triage":
        return _fake_triage_text()
    if purpose == "coach":
        return _fake_coach_text()
    return _fake_specialist_text(prompt_slug or "unknown")
