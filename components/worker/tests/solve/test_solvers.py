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


# ── Phase 1: no silent fallback when bands are missing ───────────────────────

def test_solve_freq_balance_mud_declines_without_bands():
    # Hardening: a missing low_mid/mid must leave the problem unsolved, not size
    # the EQ carve off a hardcoded 6 dB default.
    a = {"track_id": "t", "phase1": {"bands": {}}}
    v = _p("mud_buildup", "frequency_balance", "phase1.bands.low_mid", -10.0)
    assert S.solve_frequency_balance(v, a, None) is None


# ── Phase 4: mono / stereo-phase / clarity ───────────────────────────────────

def test_solve_mono_compat_sets_mono_maker():
    a = {"track_id": "t", "phase1": {"mono_compatibility": 0.4}, "phase2": {"genre": "modern_trance"}}
    v = _p("sub_mono_compatibility", "mono_compatibility", "phase1.mono_compatibility", 0.4)
    fix = S.solve_mono_compat(v, a, "modern_trance")
    assert fix is not None and fix.dsp_chain[0].type == "stereo_width"
    assert fix.dsp_chain[0].params["mono_below_hz"] == 120.0  # modern_trance crossover
    assert fix.dsp_chain[0].params["width_pct"] <= 100.0
    _ok(fix, v, a)


def test_solve_stereo_phase_narrows_and_monos():
    a = {"track_id": "t", "phase1": {"stereo_correlation": -0.4}, "phase2": {"genre": "techno"}}
    v = _p("negative_correlation", "stereo_phase", "phase1.stereo_correlation", -0.4)
    fix = S.solve_stereo_phase(v, a, "techno")
    op = fix.dsp_chain[0]
    assert op.type == "stereo_width" and op.params["width_pct"] < 100.0
    assert op.params["mono_below_hz"] > 0.0
    _ok(fix, v, a)


def test_solve_stereo_phase_handles_missing_correlation():
    a = {"track_id": "t", "phase1": {}}
    v = _p("negative_correlation", "stereo_phase", "phase1.x", 1.0)
    fix = S.solve_stereo_phase(v, a, None)
    assert fix.dsp_chain[0].params["width_pct"] == 80.0  # fallback when correlation absent


def test_solve_clarity_low_mid_carve():
    a = {"track_id": "t", "phase1": {"spectral_contrast": 10.0, "spectral_flatness": 0.4}}
    v = _p("congested_mix", "clarity", "phase1.spectral_contrast", 10.0)
    fix = S.solve_clarity(v, a, None)
    op = fix.dsp_chain[0]
    assert op.type == "peaking_eq" and op.params["gain_db"] < 0.0
    assert 20.0 <= op.params["frequency_hz"] <= 22000.0
    _ok(fix, v, a)


def test_stereo_width_accepts_mono_below_hz_rejects_out_of_range():
    import pytest
    from aimusic_shared.verdicts.models import DspOp
    DspOp(type="stereo_width", params={"width_pct": 100.0, "mono_below_hz": 120.0})  # ok
    with pytest.raises(ValueError):
        DspOp(type="stereo_width", params={"width_pct": 100.0, "mono_below_hz": 500.0})  # > 400


# ── registry ─────────────────────────────────────────────────────────────────

def test_solvers_registry_keys():
    assert {
        "clipping", "loudness", "frequency_balance", "low_end", "stereo_field",
        "mono_compatibility", "stereo_phase", "clarity",
    } <= set(S.SOLVERS)


# ── stems tier — the first solvers that don't target the master ──────────────

def _sp(slug, category):
    """A stems-tier problem. Evidence points at the stems block, which the
    fixtures below always populate."""
    return _problem(
        track_id="t", slug=slug, severity="severe", category=category,
        data_tier="stems", headline="h", summary="s", why_it_matters="w",
        evidence=[Evidence(metric="phase4.stems.status", value=None, label="ok")],
    )


def _stem_analysis(clash=None, balance=None, per_stem=None):
    return {"track_id": "t", "phase1": {}, "phase4": {"stems": {
        "status": "ok",
        "clash_matrix": clash or [],
        "balance_flags": balance or [],
        "per_stem": per_stem or {},
    }}}


def test_stem_clash_carves_the_lower_priority_stem():
    a = _stem_analysis(clash=[{
        "stem_a": "bass", "stem_b": "pad", "role_a": "bass", "role_b": "pad",
        "band": "low_mid", "overlap_severity": 0.8, "severity_tier": "critical",
    }])
    fix = S.solve_stem_clash(_sp("stem_clash", "frequency_collision"), a, None)
    assert fix is not None
    # The pad moves out of the way; the bass keeps its range.
    assert fix.target == {"type": "stem", "name": "pad"}
    op = fix.dsp_chain[0]
    assert op.type == "peaking_eq"
    assert op.params["frequency_hz"] == 320.0
    assert -4.5 <= op.params["gain_db"] < 0


def test_stem_clash_choice_does_not_depend_on_argument_order():
    row = {"band": "low_mid", "overlap_severity": 0.5, "severity_tier": "warning"}
    fwd = S.solve_stem_clash(_sp("stem_clash", "frequency_collision"), _stem_analysis(
        clash=[{**row, "stem_a": "bass", "stem_b": "pad",
                "role_a": "bass", "role_b": "pad"}]), None)
    rev = S.solve_stem_clash(_sp("stem_clash", "frequency_collision"), _stem_analysis(
        clash=[{**row, "stem_a": "pad", "stem_b": "bass",
                "role_a": "pad", "role_b": "bass"}]), None)
    assert fwd is not None and rev is not None
    assert fwd.target == rev.target == {"type": "stem", "name": "pad"}


def test_stem_clash_declines_an_unknown_band():
    fix = S.solve_stem_clash(_sp("stem_clash", "frequency_collision"), _stem_analysis(
        clash=[{"stem_a": "a", "stem_b": "b", "band": "wobble",
                "overlap_severity": 0.9, "severity_tier": "critical"}]), None)
    assert fix is None  # never invent a frequency


def test_stem_balance_regains_to_the_middle_of_the_window():
    a = _stem_analysis(
        balance=[{"role": "pad", "metric": "rms_db", "observed": -8.0,
                  "expected_range": [-20.0, -14.0], "direction": "too_high",
                  "severity_tier": "warning"}],
        per_stem={"pad": {"rms_db": -8.0}})
    fix = S.solve_stem_balance(_sp("stem_balance", "gain_staging"), a, None)
    assert fix is not None
    assert fix.target == {"type": "stem", "name": "pad"}
    # midpoint(-20, -14) = -17; observed -8 -> come down 9 dB.
    assert fix.dsp_chain[0].params["gain_db"] == -9.0


def test_stem_balance_declines_a_move_too_small_to_matter():
    a = _stem_analysis(
        balance=[{"role": "pad", "metric": "rms_db", "observed": -17.2,
                  "expected_range": [-20.0, -14.0], "direction": "too_low",
                  "severity_tier": "warning"}],
        per_stem={"pad": {"rms_db": -17.2}})
    assert S.solve_stem_balance(_sp("stem_balance", "gain_staging"), a, None) is None
