"""Coach reply payload schema tests (story 1.5).

These tests do not touch the DB or the gateway. They cover the strict
Pydantic schema that gates whatever the coach prompt emits.
"""
from __future__ import annotations

import pytest

from app.coach_lib.payload import (
    CoachEvidence,
    CoachReplyPayload,
    answer_makes_numeric_claim_without_evidence,
)


def test_answer_with_evidence_is_valid():
    p = CoachReplyPayload(
        kind="answer",
        body="Your LUFS sits at -11.2.",
        evidence=[CoachEvidence(label="LUFS -11.2", path="phase1.lufs_integrated")],
        refusal_reason=None,
    )
    assert p.kind == "answer"
    assert p.evidence[0].path == "phase1.lufs_integrated"


def test_answer_with_refusal_reason_rejected():
    with pytest.raises(ValueError):
        CoachReplyPayload(
            kind="answer",
            body="text",
            evidence=[],
            refusal_reason="missing_data",
        )


def test_refusal_with_evidence_rejected():
    with pytest.raises(ValueError):
        CoachReplyPayload(
            kind="refusal",
            body="No stems uploaded.",
            evidence=[CoachEvidence(label="X", path="y")],
            refusal_reason="missing_data",
        )


def test_refusal_with_unknown_reason_rejected():
    with pytest.raises(ValueError):
        CoachReplyPayload(
            kind="refusal",
            body="No stems.",
            evidence=[],
            refusal_reason="totally_made_up_reason",
        )


def test_refusal_with_allowed_reason_accepted():
    for reason in ("missing_data", "out_of_scope", "injection_attempt"):
        p = CoachReplyPayload(
            kind="refusal",
            body="x",
            evidence=[],
            refusal_reason=reason,
        )
        assert p.refusal_reason == reason


def test_extra_fields_rejected():
    with pytest.raises(ValueError):
        CoachReplyPayload(
            kind="answer",
            body="x",
            evidence=[],
            refusal_reason=None,
            extra="oops",  # type: ignore[call-arg]
        )


def test_numeric_answer_with_unit_and_no_evidence_flagged():
    """Story 1.5 code review B-M2 + E-H2: heuristic only triggers on
    measurement-shaped tokens (number + unit), not on bare digits."""
    p = CoachReplyPayload(
        kind="answer",
        body="Your LUFS is -11.2 dB",
        evidence=[],
        refusal_reason=None,
    )
    assert answer_makes_numeric_claim_without_evidence(p) is True


def test_text_only_answer_without_evidence_ok():
    p = CoachReplyPayload(
        kind="answer",
        body="Tighten the low end and check the kick.",
        evidence=[],
        refusal_reason=None,
    )
    assert answer_makes_numeric_claim_without_evidence(p) is False


def test_numeric_answer_with_evidence_ok():
    p = CoachReplyPayload(
        kind="answer",
        body="LUFS -11.2 dB",
        evidence=[CoachEvidence(label="LUFS -11.2", path="phase1.lufs_integrated")],
        refusal_reason=None,
    )
    assert answer_makes_numeric_claim_without_evidence(p) is False


def test_refusal_with_number_in_body_not_flagged():
    p = CoachReplyPayload(
        kind="refusal",
        body="0 stems uploaded — add stems to unlock this analysis.",
        evidence=[],
        refusal_reason="missing_data",
    )
    assert answer_makes_numeric_claim_without_evidence(p) is False


# ── Story 1.5 code review: regex tightened to require an audio unit. ───────

def test_step_numbers_in_answer_not_flagged():
    """'Step 1: ...' must NOT be demoted — pre-patch the regex matched any
    digit. Real failure mode the review caught."""
    p = CoachReplyPayload(
        kind="answer",
        body="Step 1: tighten the low end. Step 2: check the kick.",
        evidence=[],
        refusal_reason=None,
    )
    assert answer_makes_numeric_claim_without_evidence(p) is False


def test_count_phrases_not_flagged():
    p = CoachReplyPayload(
        kind="answer",
        body="Focus on the 3 main issues across the first 4 bars.",
        evidence=[],
        refusal_reason=None,
    )
    assert answer_makes_numeric_claim_without_evidence(p) is False


def test_units_other_than_dB_also_flagged():
    """Heuristic recognises the audio-engineering unit vocabulary."""
    for body in (
        "Kick at 60 Hz competes with the bass.",
        "Try a 5 kHz boost on vocals.",
        "Crest factor sits at 8 LU.",
        "Tempo is around 124 BPM.",
        "Latency budget is 50 ms.",
        "True peak hits 0.5 dBTP.",
    ):
        p = CoachReplyPayload(
            kind="answer", body=body, evidence=[], refusal_reason=None,
        )
        assert answer_makes_numeric_claim_without_evidence(p) is True, body
