"""Verdict carries the Problem-record fields (IDENTIFY tier) — additive +
defaulted so every existing constructor and persistence path is unaffected.
See PRPs/identify-solve-architecture.md §3 and PRPs/problem-engine-mixcoach-rules.md.
"""
from __future__ import annotations

from datetime import datetime, timezone

from aimusic_shared.verdicts.models import Evidence, Verdict


def _v(**over) -> Verdict:
    base = dict(
        verdict_id="vrd_x",
        track_id="t",
        specialist="rule_engine.true_peak_overshoot",
        prompt_version="rule_engine@2.0.0",
        model="rules",
        severity="severe",
        category="clipping",
        confidence=0.9,
        priority_score=80,
        headline="h",
        summary="s",
        evidence=[Evidence(metric="phase1.true_peak_db", value=0.1, label="x")],
        why_it_matters="w",
        sources=["rule_engine"],
        created_at=datetime.now(timezone.utc),
    )
    base.update(over)
    return Verdict(**base)


def test_problem_fields_default_to_audio_only_fixable_fault():
    v = _v()
    assert v.kind == "fault"
    assert v.source == "rule_engine"
    assert v.data_tier == "audio_only"
    assert v.fixable is True
    assert v.suspected is False
    assert v.problem_id is None
    assert v.where is None
    assert v.refines is None


def test_problem_fields_round_trip():
    v = _v(
        problem_id="clipping.true_peak_overshoot.0",
        data_tier="stems",
        suspected=True,
        where={"section_type": None, "start_seconds": 0, "end_seconds": 0},
        refines="dynamics.loudness_war.0",
    )
    dumped = v.model_dump()
    assert dumped["problem_id"] == "clipping.true_peak_overshoot.0"
    assert dumped["data_tier"] == "stems"
    assert dumped["suspected"] is True
    assert dumped["refines"] == "dynamics.loudness_war.0"


def test_existing_verdict_still_constructs_without_problem_fields():
    # Backward-compat: the pre-existing field set must still validate.
    v = _v()
    assert v.verdict_id == "vrd_x"
    assert v.fix is None
