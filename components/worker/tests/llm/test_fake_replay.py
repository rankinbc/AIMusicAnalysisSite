"""LLM_FAKE replay produces responses the real pipeline accepts (AR41)."""
from __future__ import annotations

import json
from datetime import datetime, timezone

from aimusic_shared.verdicts.models import SpecialistRoutingPlan, Verdict
from aimusic_shared.verdicts.ulid_helpers import new_verdict_id

from app.llm.fake import fake_response_text
from app.verdict_lib.validator import validate_verdict


def test_fake_specialist_survives_validator():
    text = fake_response_text(purpose="specialist", prompt_slug="low_end")
    raw = json.loads(text)["verdicts"][0]
    verdict = Verdict(
        verdict_id=new_verdict_id(),
        track_id="track-1",
        specialist="low_end",
        prompt_version="low_end@fake",
        model="fake",
        priority_score=0,
        sources=["low_end"],
        related_verdict_ids=[],
        user_state={},
        created_at=datetime.now(tz=timezone.utc).isoformat(),
        **raw,
    )
    # Empty evidence → nothing to resolve → validation passes against any analysis.
    result = validate_verdict(verdict, {"phase1": {"duration_seconds": 300}})
    assert result.ok
    assert result.verdict is not None


def test_fake_triage_parses_to_routing_plan():
    text = fake_response_text(purpose="triage", prompt_slug="triage")
    plan = SpecialistRoutingPlan(**json.loads(text))
    assert plan.specialists_to_run == []
    assert isinstance(plan.skip, list)


def test_fake_specialist_keyed_by_slug():
    a = fake_response_text(purpose="specialist", prompt_slug="dynamics")
    assert "dynamics" in a


def test_fake_coach_parses_to_coach_reply_payload():
    """Story 1.5 code review E-H3: ``LLM_FAKE=1`` for ``purpose="coach"``
    MUST emit a CoachReplyPayload-compatible JSON; otherwise the coach
    actor demotes every reply to ``status="error"`` and AR41's
    end-to-end-with-zero-spend guarantee breaks."""
    from app.coach_lib.payload import (  # noqa: PLC0415 — keep fake.py-free of coach_lib
        CoachReplyPayload,
        answer_makes_numeric_claim_without_evidence,
    )

    text = fake_response_text(purpose="coach", prompt_slug="coach_grounded")
    payload = CoachReplyPayload(**json.loads(text))
    assert payload.kind == "answer"
    assert payload.body
    assert payload.evidence == []
    assert payload.refusal_reason is None
    # The numeric-without-evidence heuristic must NOT reject the fake body —
    # otherwise the actor will downgrade to status="error".
    assert answer_makes_numeric_claim_without_evidence(payload) is False
