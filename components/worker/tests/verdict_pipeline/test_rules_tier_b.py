"""Tier-B rules — fire from the phase-1 datapoint lifts surfaced in schema 2.1.0:
channel_balance (B5), sub_30_energy (B3), key_estimate (B4). Each tested fires +
silent + absent-field, and that its evidence path resolves.
"""
from __future__ import annotations

from app.verdict_lib import rule_engine as RE
from app.verdict_lib.validator import validate_verdict


def _a(phase1: dict) -> dict:
    return {"track_id": "t", "phase1": phase1}


# ── B5 channel_imbalance ────────────────────────────────────────────────────

def test_channel_imbalance_fires_on_large_offset():
    a = _a({"channel_balance": {"balance_db": 7.0, "l_rms_db": -10.0, "r_rms_db": -17.0}})
    v = RE.channel_imbalance(a)
    assert v is not None
    assert v.category == "stereo_field" and v.severity == "severe"
    assert v.evidence[0].metric == "phase1.channel_balance.balance_db"
    assert validate_verdict(v, a).ok


def test_channel_imbalance_silent_when_balanced():
    assert RE.channel_imbalance(_a({"channel_balance": {"balance_db": 0.5}})) is None


def test_channel_imbalance_silent_when_field_absent():
    assert RE.channel_imbalance(_a({})) is None


# ── B3 sub_rumble ───────────────────────────────────────────────────────────

def test_sub_rumble_fires_when_sub30_dominates_low_band():
    a = _a({"sub_30_energy": 0.5, "low_energy": 1.0})  # 50% of the low band
    v = RE.sub_rumble(a)
    assert v is not None and v.category == "low_end" and v.suspected is True
    assert validate_verdict(v, a).ok


def test_sub_rumble_silent_when_little_sub30():
    assert RE.sub_rumble(_a({"sub_30_energy": 0.05, "low_energy": 1.0})) is None


def test_sub_rumble_silent_when_no_low_energy():
    assert RE.sub_rumble(_a({"sub_30_energy": 0.5, "low_energy": 0.0})) is None


# ── B4 modal_ambiguity ──────────────────────────────────────────────────────

def test_modal_ambiguity_fires_when_top_two_keys_close():
    corrs = [0.90, 0.88] + [0.1] * 22  # top-2 within 0.02, both strong
    a = _a({"key_estimate": {"key": "A", "mode": "minor", "second_key": "C",
                             "second_mode": "major", "confidence": 0.90, "profile_corrs": corrs}})
    v = RE.modal_ambiguity(a)
    assert v is not None and v.category == "harmonic"
    assert v.fixable is False  # observation, no solver
    assert validate_verdict(v, a).ok


def test_modal_ambiguity_silent_when_one_key_dominates():
    corrs = [0.92, 0.40] + [0.1] * 22
    a = _a({"key_estimate": {"key": "C", "mode": "major", "second_key": "G",
                             "second_mode": "major", "confidence": 0.92, "profile_corrs": corrs}})
    assert RE.modal_ambiguity(a) is None


def test_modal_ambiguity_silent_when_no_tonal_centre():
    corrs = [0.30, 0.29] + [0.1] * 22  # close, but neither is a real key (<0.5)
    a = _a({"key_estimate": {"key": "C", "mode": "major", "second_key": "G",
                             "second_mode": "major", "confidence": 0.30, "profile_corrs": corrs}})
    assert RE.modal_ambiguity(a) is None


# ── B1 missing_sidechain (conservative; suspected) ───────────────────────────

def _beats(n=20):
    return [i * 0.42 for i in range(n)]


def test_missing_sidechain_fires_on_flat_dense_low_end():
    a = _a({"loudness_timeline": {"momentary": {"t": _beats(), "lufs": [-9.0] * 20}},
            "structure": {"beats": _beats()}, "low_energy": 0.5})
    v = RE.missing_sidechain(a)
    assert v is not None and v.suspected is True and v.category == "low_end"
    assert validate_verdict(v, a).ok


def test_missing_sidechain_silent_when_pumping():
    a = _a({"loudness_timeline": {"momentary": {"t": _beats(), "lufs": [-9.0, -15.0] * 10}},
            "structure": {"beats": _beats()}, "low_energy": 0.5})
    assert RE.missing_sidechain(a) is None


def test_missing_sidechain_silent_without_beats():
    a = _a({"loudness_timeline": {"momentary": {"t": [], "lufs": [-9.0] * 20}},
            "structure": {"beats": []}, "low_energy": 0.5})
    assert RE.missing_sidechain(a) is None


# ── C4 untreated_low_end composite ───────────────────────────────────────────

def test_untreated_low_end_fires_and_suppresses_b1():
    a = _a({"loudness_timeline": {"momentary": {"t": _beats(), "lufs": [-9.0] * 20}},
            "structure": {"beats": _beats()}, "low_energy": 0.5,
            "bands": {"bass": -8.0, "sub_bass": -6.0}})
    out = RE.evaluate_problems(
        a,
        singles=[("missing_sidechain", RE.missing_sidechain)],
        composites=[("untreated_low_end", ["missing_sidechain", "thin_low_end"],
                     RE.untreated_low_end)],
    )
    slugs = {v.problem_id.split(".")[1] for v in out}
    assert "untreated_low_end" in slugs
    assert "missing_sidechain" not in slugs  # absorbed by the composite
    comp = next(v for v in out if v.problem_id.endswith("untreated_low_end.0"))
    assert comp.suspected is False and comp.severity == "severe"
    assert validate_verdict(comp, a).ok


def test_untreated_low_end_silent_without_b1():
    a = _a({"low_energy": 0.5, "bands": {"bass": -8.0, "sub_bass": -6.0}})
    out = RE.evaluate_problems(
        a, singles=[],
        composites=[("untreated_low_end", ["missing_sidechain"], RE.untreated_low_end)],
    )
    assert out == []
