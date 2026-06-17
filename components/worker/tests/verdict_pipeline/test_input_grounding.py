"""Absent/failed inputs must be marked NOT PROVIDED so the live model stops
inventing stems / a reference track from skipped phase-4/5 scaffolding."""
from app.verdict_lib.input_grounding import grounding_preamble, input_provenance

# Shape taken verbatim from a real bare-mix analysis (phase 5 skipped, phase 4
# stems failed to load).
REAL_BARE_MIX = {
    "phase4": {
        "stems": {"status": "failed", "error": "Error opening ...flac"},
        "clashes": [{"severity": "high"}],
    },
    "phase5": {
        "status": "skipped",
        "deltas": {},
        "stem_reference_comparison": "unavailable",
    },
}


def test_reference_skipped_is_not_provided():
    p = input_provenance(REAL_BARE_MIX)
    assert p["reference"] is False
    text = grounding_preamble(REAL_BARE_MIX)
    assert "Reference track: NO" in text
    assert "Do NOT mention, infer, or compare" in text


def test_failed_stems_flagged_unreadable():
    assert input_provenance(REAL_BARE_MIX)["stems"] == "failed"
    assert "PROVIDED BUT UNREADABLE" in grounding_preamble(REAL_BARE_MIX)


def test_truly_absent_stems_and_reference():
    p = input_provenance({"phase1": {"lufs": -8}})
    assert p == {"mix": True, "stems": "absent", "reference": False}
    text = grounding_preamble({})
    assert "Separated stems: NO" in text
    assert "Reference track: NO" in text


def test_present_inputs_are_allowed():
    full = {
        "phase4": {"stems": {"status": "ok"}},
        "phase5": {"status": "ok", "deltas": {"lufs": 1.2}},
    }
    p = input_provenance(full)
    assert p["stems"] == "ok"
    assert p["reference"] is True
    text = grounding_preamble(full)
    assert "Separated stems: YES" in text
    assert "Reference track: YES" in text
