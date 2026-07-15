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


# Story 1.5 code review E-H3 + story 1.6 P8: single source of truth for
# the fake coach body so the v1 (`_fake_coach_text`) and v2 streaming
# (`fake_coach_stream_chunks`) paths can never drift. Body intentionally
# numeric-free so ``answer_makes_numeric_claim_without_evidence`` doesn't
# demote it; empty evidence keeps the placeholder honest.
_FAKE_COACH_PROSE = (
    "[FAKE] LLM_FAKE replay — this is a placeholder coach reply for "
    "local development. Real answers cite measured values from your "
    "analysis."
)
_FAKE_COACH_EVIDENCE_JSON = (
    '{"kind":"answer","evidence":[],"refusal_reason":null}'
)


def _fake_coach_text() -> str:
    """Story 1.5 code review E-H3: without this branch the coach actor
    received specialist-shaped JSON in ``LLM_FAKE=1`` mode, the Pydantic
    schema rejected it, and every coach reply persisted as
    ``status="error"`` — breaking AR41's end-to-end-with-zero-spend
    guarantee for the dev/CI default.
    """
    return json.dumps({
        "kind": "answer",
        "body": _FAKE_COACH_PROSE,
        "evidence": [],
        "refusal_reason": None,
    })


def _fake_coach_mix_text() -> str:
    """Same failure mode as the coach branch above (E-H3): without this,
    the coach-mix arbiter received specialist-shaped JSON under ``LLM_FAKE=1``,
    ``ArbiterResponse`` rejected it, and every dev/CI fix rack persisted
    ``degraded=True``. An empty decisions list keeps the deterministic chain
    and reads as a real "LLM had nothing to add" run.
    """
    return json.dumps({"decisions": []})


def fake_response_text(*, purpose: str, prompt_slug: str | None) -> str:
    """Canned response text for one fake call."""
    if purpose == "triage":
        return _fake_triage_text()
    if purpose == "coach":
        return _fake_coach_text()
    if purpose == "coach_mix":
        return _fake_coach_mix_text()
    return _fake_specialist_text(prompt_slug or "unknown")


def fake_coach_stream_chunks() -> list[str]:
    """Deterministic delta sequence for the streaming fake coach path
    (AR41 + story 1.6 AC2 — ≥3 token frames per fake reply).

    Splits the prose into 5 deltas, then emits the sentinel + evidence
    JSON as further deltas so the consumer's ``StreamSplitter`` sees the
    full v2 wire format. The non-streaming :func:`fake_response_text`
    (used by batch ``complete_sync``) keeps the v1 single-JSON-object
    output — it predates v2 and is only exercised when a non-coach test
    or a legacy ``complete_sync`` consumer hits coach purpose.
    """
    prose = _FAKE_COACH_PROSE
    # Split prose roughly evenly into 5 chunks at word boundaries.
    words = prose.split(" ")
    n_chunks = 5
    chunk_size = max(1, -(-len(words) // n_chunks))  # ceil divide
    prose_chunks: list[str] = []
    for i in range(0, len(words), chunk_size):
        slice_words = words[i:i + chunk_size]
        # Preserve inter-word space; trailing chunk gets no extra space.
        text = " ".join(slice_words)
        if i + chunk_size < len(words):
            text += " "
        prose_chunks.append(text)
    return prose_chunks + ["\n<<<EVIDENCE>>>\n", _FAKE_COACH_EVIDENCE_JSON]
