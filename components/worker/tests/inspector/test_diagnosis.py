from __future__ import annotations

from app.tools.inspector.diagnosis import (
    analysis_inputs,
    diagnose_rule,
    phase_run_states,
)


def test_phase_run_states_distinguishes_ran_skipped_absent():
    flat = {"phase1": {"lufs": -10}, "phase5": {"status": "skipped", "deltas": {}}}
    st = phase_run_states(flat)
    assert st["phase1"] == "ran"
    assert st["phase5"] == "skipped"
    assert st["phase8"] == "absent"


def test_analysis_inputs_detects_provenance():
    flat = {"phase1": {"lufs": -10}, "phase4": {"stems": {}}, "phase5": {"status": "skipped"}}
    inp = analysis_inputs(flat)
    assert inp == {"music": True, "reference": False, "stems": False, "als": False}


def test_analysis_inputs_present_optional_inputs():
    flat = {
        "phase1": {"lufs": -10},
        "phase4": {"stems": {"kick": {}}},
        "phase5": {"status": "ok", "deltas": {}},
        "phase8": {"health_score": 70},
    }
    inp = analysis_inputs(flat)
    assert inp == {"music": True, "reference": True, "stems": True, "als": True}


def test_diagnose_bug_when_phase_ran_but_field_absent():
    rule = {"fired": False, "path_resolution": {"phase1.integrated_lufs": "missing"}}
    dx, reason = diagnose_rule(rule, {"phase1": "ran"})
    assert dx == "bug"
    assert "phase1.integrated_lufs" in reason


def test_diagnose_input_gated_when_phase_skipped():
    rule = {"fired": False, "path_resolution": {"phase5.deltas": "missing"}}
    dx, _ = diagnose_rule(rule, {"phase5": "skipped"})
    assert dx == "input_gated"


def test_diagnose_in_range_when_all_present_but_idle():
    rule = {"fired": False, "path_resolution": {"phase1.clipping_detected": "present"}}
    dx, _ = diagnose_rule(rule, {"phase1": "ran"})
    assert dx == "in_range"


def test_diagnose_bare_key_is_bug():
    rule = {"fired": False, "path_resolution": {"genre_hint": "missing"}}
    dx, _ = diagnose_rule(rule, {})
    assert dx == "bug"


def test_diagnose_fired():
    dx, _ = diagnose_rule({"fired": True, "path_resolution": {}}, {})
    assert dx == "fired"
