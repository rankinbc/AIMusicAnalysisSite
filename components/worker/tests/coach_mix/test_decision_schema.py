import pytest
from pydantic import ValidationError
from app.coach_mix.decision_schema import ArbiterResponse


def test_parses_valid_decisions():
    r = ArbiterResponse.model_validate({"decisions": [
        {"call_index": 0, "action": "drop", "params": None, "rationale": "clean mix"},
        {"call_index": 1, "action": "add_glue", "params": {"ratio": 1.5, "threshold_db": -18.0,
                                                            "attack_ms": 30.0, "release_ms": 120.0},
         "rationale": "gentle glue"},
    ]})
    assert len(r.decisions) == 2
    assert r.decisions[1].action == "add_glue"


def test_rejects_unknown_action():
    with pytest.raises(ValidationError):
        ArbiterResponse.model_validate({"decisions": [
            {"call_index": 0, "action": "nuke", "rationale": "x"}]})


def test_parses_keep_blend_adjust_actions():
    r = ArbiterResponse.model_validate({"decisions": [
        {"call_index": 0, "action": "keep", "rationale": "fine"},
        {"call_index": 1, "action": "blend", "params": {"frequency_hz": 300.0, "gain_db": -2.0}, "rationale": "merge"},
        {"call_index": 2, "action": "adjust", "params": {"gain_db": -1.0}, "rationale": "trim"},
    ]})
    assert [d.action for d in r.decisions] == ["keep", "blend", "adjust"]
