"""Stem (S) + MIDI (P) problem rules — data-tier tagged, gated on presence.

Each rule returns None when its data tier is absent (never grades missing data):
S rules need phase4.stems.status == "ok"; P rules need a non-empty phase8.
"""
from __future__ import annotations

from app.verdict_lib import rule_engine as RE
from app.verdict_lib.validator import validate_verdict


# ── fixtures ────────────────────────────────────────────────────────────────

def _stems(status="ok", clash=None, per_stem=None):
    return {"track_id": "t", "phase4": {"stems": {
        "status": status,
        "clash_matrix": [] if clash is None else clash,
        "per_stem": per_stem or {},
    }}}


def _midi(**phase8):
    return {"track_id": "t", "phase8": phase8}


# ── S1 stem_clash ───────────────────────────────────────────────────────────

def test_stem_clash_critical_is_severe_with_stems_evidence():
    a = _stems(clash=[
        {"stem_a": "kick", "stem_b": "bass", "band": "sub", "severity_tier": "warning"},
        {"stem_a": "lead", "stem_b": "pad", "band": "low_mid", "severity_tier": "critical"},
    ])
    v = RE.stem_clash(a)
    assert v is not None and v.severity == "severe"
    assert v.category == "frequency_collision" and v.data_tier == "stems"
    assert v.evidence[0].stems == ["lead", "pad"]
    assert v.evidence[0].frequency_range_hz == (200.0, 500.0)
    assert validate_verdict(v, a).ok


def test_stem_clash_warning_only_is_moderate():
    a = _stems(clash=[{"stem_a": "kick", "stem_b": "bass", "band": "sub",
                       "severity_tier": "warning"}])
    v = RE.stem_clash(a)
    assert v is not None and v.severity == "moderate"


def test_stem_clash_gate_silent():
    # not analyzed, no stems block, and ok-but-no-clashes all stay silent
    assert RE.stem_clash(_stems(status="absent",
                                clash=[{"stem_a": "a", "stem_b": "b", "band": "sub",
                                        "severity_tier": "critical"}])) is None
    assert RE.stem_clash({"track_id": "t"}) is None
    assert RE.stem_clash(_stems(clash=[])) is None


# ── S2 stem_balance ─────────────────────────────────────────────────────────

def test_stem_balance_fires_on_flag():
    a = _stems(per_stem={"bass": {"direction": "loud", "severity_tier": "warning"},
                         "lead": {"direction": "ok", "severity_tier": "ok"}})
    v = RE.stem_balance(a)
    assert v is not None and v.category == "gain_staging" and v.data_tier == "stems"
    assert v.severity == "moderate"
    assert v.evidence[0].stems == ["bass"]
    assert validate_verdict(v, a).ok


def test_stem_balance_gate_silent():
    assert RE.stem_balance(_stems(status="absent",
                                  per_stem={"bass": {"severity_tier": "critical"}})) is None
    assert RE.stem_balance(_stems(per_stem={"lead": {"severity_tier": "ok"}})) is None
    assert RE.stem_balance(_stems(per_stem={})) is None


# ── P1 robotic_velocity ─────────────────────────────────────────────────────

def test_robotic_velocity_zero_std_is_critical():
    a = _midi(per_track_analysis={
        "Hat": {"velocity_std": 12.0, "humanization_score": "human"},
        "Lead": {"velocity_std": 0.0, "humanization_score": "robotic"}})
    v = RE.robotic_velocity(a)
    assert v is not None and v.severity == "critical"
    assert v.category == "humanization" and v.data_tier == "project_midi"
    assert v.where is None
    assert validate_verdict(v, a).ok


def test_robotic_velocity_low_std_is_severe():
    a = _midi(per_track_analysis={"Lead": {"velocity_std": 2.0,
                                           "humanization_score": "stiff"}})
    v = RE.robotic_velocity(a)
    assert v is not None and v.severity == "severe"


def test_robotic_velocity_silent_when_humanized():
    a = _midi(per_track_analysis={"Lead": {"velocity_std": 18.0,
                                           "humanization_score": "human"}})
    assert RE.robotic_velocity(a) is None


# ── P2 no_headroom ──────────────────────────────────────────────────────────

def test_no_headroom_fires_when_faders_pinned():
    a = _midi(tracks=[{"volume_db": 0.0, "muted": False},
                      {"volume_db": -0.2, "muted": False},
                      {"volume_db": 0.1, "muted": False}])
    v = RE.no_headroom(a)
    assert v is not None and v.severity == "moderate" and v.category == "gain_staging"
    assert v.data_tier == "project_midi"
    assert validate_verdict(v, a).ok


def test_no_headroom_silent_with_varied_gain_staging():
    a = _midi(tracks=[{"volume_db": -18.0, "muted": False},
                      {"volume_db": -6.0, "muted": False},
                      {"volume_db": -12.0, "muted": False}])
    assert RE.no_headroom(a) is None


# ── P3 quantization_issues ──────────────────────────────────────────────────

def test_quantization_issues_fires_by_count():
    a = _midi(quantization_issues_count=12, midi_issues=[{"type": "off_grid"}])
    v = RE.quantization_issues(a)
    assert v is not None and v.category == "humanization" and v.severity == "moderate"
    assert validate_verdict(v, a).ok


def test_quantization_issues_silent_when_clean():
    assert RE.quantization_issues(_midi(quantization_issues_count=0)) is None


# ── P4 project_clutter (suspected) ──────────────────────────────────────────

def test_project_clutter_fires_suspected():
    a = _midi(clutter_pct=0.6, disabled_devices=20)
    v = RE.project_clutter(a)
    assert v is not None and v.suspected is True and v.category == "device_chain"
    assert v.data_tier == "project_midi"
    assert validate_verdict(v, a).ok


def test_project_clutter_silent_when_tidy():
    assert RE.project_clutter(_midi(clutter_pct=0.1, disabled_devices=1)) is None


# ── presence gates: every P rule silent without phase8 ──────────────────────

def test_midi_rules_gate_silent_without_phase8():
    for fn in (RE.robotic_velocity, RE.no_headroom, RE.quantization_issues,
               RE.project_clutter):
        assert fn({"track_id": "t"}) is None
        assert fn({"track_id": "t", "phase8": {}}) is None


# ── all six registered as singles ───────────────────────────────────────────

def test_stem_midi_singles_registered():
    registered = {slug for slug, _fn in RE._SINGLES}
    assert {"stem_clash", "stem_balance", "robotic_velocity", "no_headroom",
            "quantization_issues", "project_clutter"} <= registered
