# components/shared/tests/test_verdict_schema.py
from __future__ import annotations
import pytest
from datetime import datetime, timezone
from pydantic import ValidationError
from aimusic_shared.verdicts.models import (
    Verdict, Fix, Evidence, DspOp, UserState, SpecialistRoutingPlan,
)
from aimusic_shared.verdicts.ulid_helpers import (
    new_verdict_id, new_fix_id, is_verdict_id, is_fix_id,
)


def _minimal_verdict(**overrides) -> dict:
    base = dict(
        verdict_id=new_verdict_id(),
        track_id="track-1",
        specialist="rule_engine",
        prompt_version="rule_engine@1.0.0",
        model="rules",
        severity="moderate",
        category="loudness",
        confidence=0.8,
        priority_score=70,
        headline="Headline",
        summary="Summary text.",
        evidence=[Evidence(metric="phase1.integrated_lufs", value=-7.0,
                           label="LUFS too high")],
        fix=None,
        why_it_matters="It matters.",
        related_verdict_ids=[],
        sources=["rule_engine"],
        user_state=UserState(),
        created_at=datetime.now(tz=timezone.utc),
    )
    base.update(overrides)
    return base


def test_minimal_verdict_validates():
    v = Verdict(**_minimal_verdict())
    assert v.severity == "moderate"
    assert is_verdict_id(v.verdict_id)


def test_severity_must_be_in_enum():
    with pytest.raises(ValidationError):
        Verdict(**_minimal_verdict(severity="catastrophic"))


def test_confidence_out_of_range():
    with pytest.raises(ValidationError):
        Verdict(**_minimal_verdict(confidence=1.2))
    with pytest.raises(ValidationError):
        Verdict(**_minimal_verdict(confidence=-0.1))


def test_dsp_peaking_eq_gain_in_range():
    DspOp(type="peaking_eq", params={"frequency_hz": 250, "gain_db": -4.0, "q": 1.2})
    with pytest.raises(ValidationError):
        DspOp(type="peaking_eq", params={"frequency_hz": 250, "gain_db": -30.0, "q": 1.2})
    with pytest.raises(ValidationError):
        DspOp(type="peaking_eq", params={"frequency_hz": 25000, "gain_db": -4.0, "q": 1.2})


def test_dsp_compressor_ratio_in_range():
    DspOp(type="compressor", params={"threshold_db": -20, "ratio": 4,
                                     "attack_ms": 5, "release_ms": 80, "knee_db": 6})
    with pytest.raises(ValidationError):
        DspOp(type="compressor", params={"threshold_db": -20, "ratio": 50,
                                         "attack_ms": 5, "release_ms": 80, "knee_db": 6})


def test_unknown_dsp_type_rejected():
    with pytest.raises(ValidationError):
        DspOp(type="bitcrusher", params={"bits": 8})


def test_evidence_required_fields():
    Evidence(metric="phase1.integrated_lufs", label="x")
    with pytest.raises(ValidationError):
        Evidence(label="x")  # missing metric


def test_fix_with_dsp_chain():
    f = Fix(
        fix_id=new_fix_id(),
        target={"type": "stem", "name": "bass"},
        section=None,
        dsp_chain=[DspOp(type="peaking_eq",
                         params={"frequency_hz": 250, "gain_db": -4.0, "q": 1.2})],
        sidechain=None,
        expected_outcome="Cleaner low end.",
        ableton_hint=None,
    )
    assert is_fix_id(f.fix_id)
    assert len(f.dsp_chain) == 1


def test_routing_plan_validates():
    p = SpecialistRoutingPlan(
        specialists_to_run=[{"name": "low_end", "priority": 1, "focus": "kick-bass"}],
        skip=["spatial"],
        rationale="Low end dominates.",
        estimated_total_tokens=15000,
    )
    assert p.specialists_to_run[0]["name"] == "low_end"
