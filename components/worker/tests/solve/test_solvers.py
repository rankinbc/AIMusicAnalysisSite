"""Deterministic solvers: each maps a Problem (Verdict) -> a parameter-exact Fix
whose DspOp params are in-range and whose merged verdict passes the validator.
"""
from __future__ import annotations

from aimusic_shared.verdicts.models import Evidence
from app.solve_lib import solvers as S
from app.verdict_lib.rule_engine import _problem
from app.verdict_lib.validator import validate_verdict


def _p(slug, category, evidence_metric, value):
    return _problem(
        track_id="t", slug=slug, severity="severe", category=category,
        headline="h", summary="s", why_it_matters="w",
        evidence=[Evidence(metric=evidence_metric, value=value, label="x")],
    )


def _ok(fix, v, a):
    v2 = v.model_copy(update={"fix": fix})
    assert validate_verdict(v2, a).ok


# ── clipping -> limiter ──────────────────────────────────────────────────────

def test_solve_clipping_limiter():
    a = {"track_id": "t", "phase1": {"true_peak_db": 0.4}, "phase2": {"genre": "techno"}}
    v = _p("true_peak_overshoot", "clipping", "phase1.true_peak_db", 0.4)
    fix = S.solve_clipping(v, a, "techno")
    assert fix is not None and fix.dsp_chain[0].type == "limiter"
    assert -6.0 <= fix.dsp_chain[0].params["ceiling_db"] <= 0.0
    assert fix.target["type"] == "master"
    _ok(fix, v, a)


# ── loudness -> gain trim (only when too loud) ───────────────────────────────

def test_solve_loudness_trims_when_too_loud():
    a = {"track_id": "t", "phase1": {"lufs": -6.0}, "phase2": {"genre": "modern_trance"}}
    v = _p("loudness_vs_target", "loudness", "phase1.lufs", -6.0)
    fix = S.solve_loudness(v, a, "modern_trance")
    assert fix is not None and fix.dsp_chain[0].type == "gain"
    assert fix.dsp_chain[0].params["gain_db"] < 0.0
    _ok(fix, v, a)


def test_solve_loudness_declines_when_too_quiet():
    a = {"track_id": "t", "phase1": {"lufs": -20.0}, "phase2": {"genre": "modern_trance"}}
    v = _p("loudness_vs_target", "loudness", "phase1.lufs", -20.0)
    assert S.solve_loudness(v, a, "modern_trance") is None  # gain-up isn't a master move


# ── frequency_balance -> eq ──────────────────────────────────────────────────

def test_solve_freq_balance_mud_cut():
    a = {"track_id": "t", "phase1": {"bands": {"low_mid": -10.0, "mid": -20.0}}}
    v = _p("mud_buildup", "frequency_balance", "phase1.bands.low_mid", -10.0)
    fix = S.solve_frequency_balance(v, a, None)
    op = fix.dsp_chain[0]
    assert op.type == "peaking_eq" and op.params["gain_db"] < 0.0
    assert 20.0 <= op.params["frequency_hz"] <= 22000.0
    _ok(fix, v, a)


def test_solve_freq_balance_dull_boost():
    a = {"track_id": "t", "phase1": {"bands": {"air": -80.0}}}
    v = _p("dull_no_air", "frequency_balance", "phase1.bands.air", -80.0)
    fix = S.solve_frequency_balance(v, a, None)
    assert fix.dsp_chain[0].type == "high_shelf" and fix.dsp_chain[0].params["gain_db"] > 0.0
    _ok(fix, v, a)


# ── low_end -> shelf boost / high-pass ───────────────────────────────────────

def test_solve_low_end_subrumble_highpass():
    a = {"track_id": "t", "phase1": {"sub_30_energy": 0.5, "low_energy": 1.0}}
    v = _p("sub_rumble", "low_end", "phase1.sub_30_energy", 0.5)
    fix = S.solve_low_end(v, a, None)
    op = fix.dsp_chain[0]
    assert op.type == "high_pass" and op.params["frequency_hz"] <= 40.0
    _ok(fix, v, a)


def test_solve_low_end_thin_boost():
    a = {"track_id": "t", "phase1": {"low_energy": 0.05}}
    v = _p("thin_low_end", "low_end", "phase1.low_energy", 0.05)
    fix = S.solve_low_end(v, a, None)
    assert fix.dsp_chain[0].type == "low_shelf" and fix.dsp_chain[0].params["gain_db"] > 0.0
    _ok(fix, v, a)


# ── stereo_field -> width ────────────────────────────────────────────────────

def test_solve_stereo_narrows():
    a = {"track_id": "t", "phase1": {"stereo_width": 0.6}}
    v = _p("over_widened", "stereo_field", "phase1.stereo_width", 0.6)
    fix = S.solve_stereo_field(v, a, None)
    op = fix.dsp_chain[0]
    assert op.type == "stereo_width" and op.params["width_pct"] < 100.0
    _ok(fix, v, a)


# ── registry ─────────────────────────────────────────────────────────────────

def test_solvers_registry_keys():
    assert {"clipping", "loudness", "frequency_balance", "low_end", "stereo_field"} <= set(S.SOLVERS)
