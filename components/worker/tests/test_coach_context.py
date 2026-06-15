"""Coach context-bundle + evidence-resolver tests (story 1.5).

Pure-function tests — no DB, no gateway. The bundle is built from
already-loaded dicts, so the actor's Phase A is out of scope here.
"""
from __future__ import annotations

from app.coach_lib.context import build_context_bundle, resolve_evidence
from app.coach_lib.payload import CoachEvidence
from app.verdict_lib.flatten_analysis import flatten


# ── build_context_bundle ───────────────────────────────────────────────────

def test_bundle_includes_flattened_analysis():
    flat = {"phase1": {"lufs_integrated": -11.2}, "grade": "B"}
    b = build_context_bundle(
        flattened_analysis=flat, verdicts=[], conversation_tail=[],
    )
    assert b["analysis"] == flat
    assert b["verdicts"] == []
    assert b["als_summary"] is None
    assert b["conversation_tail"] == []


def test_bundle_uses_real_pipeline_shape_via_flatten():
    # Regression for the story-1.4 class of bug — real pipeline emits
    # {"phases": [...]}, NOT pre-flattened {phase1: {...}}. The actor
    # calls flatten() upstream; this test pins the contract.
    raw = {
        "phases": [
            {"phase": 1, "name": "intake", "data": {"lufs_integrated": -11.2}},
            {"phase": 4, "name": "stems", "data": {"clashes": []}},
        ],
        "grade": "B",
    }
    bundle = build_context_bundle(
        flattened_analysis=flatten(raw),
        verdicts=[],
        conversation_tail=[],
    )
    assert bundle["analysis"]["phase1"]["lufs_integrated"] == -11.2
    assert bundle["analysis"]["phase4"]["clashes"] == []
    assert bundle["analysis"]["grade"] == "B"


def test_bundle_keeps_top_40_verdicts_by_priority():
    verdicts = [{"priority_score": i, "headline": f"v{i}"} for i in range(60)]
    bundle = build_context_bundle(
        flattened_analysis={},
        verdicts=verdicts,
        conversation_tail=[],
    )
    assert len(bundle["verdicts"]) == 40
    # Top of the list is the highest priority (59).
    assert bundle["verdicts"][0]["priority_score"] == 59
    assert bundle["verdicts"][-1]["priority_score"] == 20


def test_bundle_picks_als_summary_when_present():
    flat = {"phase1": {}, "als_summary": {"tracks": ["kick", "bass"]}}
    bundle = build_context_bundle(
        flattened_analysis=flat, verdicts=[], conversation_tail=[],
    )
    assert bundle["als_summary"] == {"tracks": ["kick", "bass"]}


def test_bundle_caps_tail_to_last_10():
    tail = [{"role": "user", "body": f"q{i}"} for i in range(15)]
    bundle = build_context_bundle(
        flattened_analysis={}, verdicts=[], conversation_tail=tail,
    )
    assert len(bundle["conversation_tail"]) == 10
    # Most recent kept (q14), oldest dropped (q0..q4).
    assert bundle["conversation_tail"][0]["body"] == "q5"
    assert bundle["conversation_tail"][-1]["body"] == "q14"


# ── resolve_evidence ───────────────────────────────────────────────────────

def test_resolves_phase_path_via_analysis_prefix():
    bundle = build_context_bundle(
        flattened_analysis={"phase1": {"lufs_integrated": -11.2}},
        verdicts=[],
        conversation_tail=[],
    )
    chips = [CoachEvidence(label="LUFS -11.2", path="phase1.lufs_integrated")]
    kept = resolve_evidence(chips, bundle)
    assert len(kept) == 1
    assert kept[0].path == "phase1.lufs_integrated"


def test_drops_unresolvable_path():
    bundle = build_context_bundle(
        flattened_analysis={"phase1": {"lufs_integrated": -11.2}},
        verdicts=[],
        conversation_tail=[],
    )
    chips = [
        CoachEvidence(label="LUFS -11.2", path="phase1.lufs_integrated"),
        CoachEvidence(label="X", path="nonexistent.key"),
    ]
    kept = resolve_evidence(chips, bundle)
    assert [c.path for c in kept] == ["phase1.lufs_integrated"]


def test_resolves_verdict_array_subscript():
    bundle = build_context_bundle(
        flattened_analysis={},
        verdicts=[
            {"priority_score": 100, "headline": "Hard clipping detected"},
            {"priority_score": 50, "headline": "Low end is muddy"},
        ],
        conversation_tail=[],
    )
    chips = [CoachEvidence(label="V2", path="verdicts[1].headline")]
    kept = resolve_evidence(chips, bundle)
    assert kept and kept[0].path == "verdicts[1].headline"


def test_resolve_never_raises_on_garbage_path():
    bundle = {"analysis": {}, "verdicts": [], "als_summary": None,
              "conversation_tail": []}
    chips = [CoachEvidence(label="X", path="!@#$%^&*("),
             CoachEvidence(label="Y", path="phase1[bad].deep")]
    # Should silently drop, not raise.
    kept = resolve_evidence(chips, bundle)
    assert kept == []


def test_drops_chip_pointing_at_null_value():
    bundle = build_context_bundle(
        flattened_analysis={"phase1": {"lufs_integrated": None}},
        verdicts=[],
        conversation_tail=[],
    )
    chips = [CoachEvidence(label="LUFS none", path="phase1.lufs_integrated")]
    kept = resolve_evidence(chips, bundle)
    assert kept == []
