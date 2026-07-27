"""Preset compiler: Fix[] -> rack chain. Filters non-master/sidechain moves to
leftover advice, translates DspOp -> module params (snake->camel), dedups one
module instance (the 4-limiter case), preserves chain order.
"""
from __future__ import annotations

from aimusic_shared.verdicts.models import DspOp, Evidence, Fix
from app.solve_lib import rack_schema as R
from app.solve_lib.preset_compiler import compile_preset
from app.verdict_lib.rule_engine import _problem


def _vfix(pid, op, *, conf=0.9, prio=50, target_type="master", sidechain=None):
    cat, slug = pid.split(".")[0], pid.split(".")[1]
    v = _problem(track_id="t", slug=slug, severity="severe", category=cat,
                 headline="h", summary="s", why_it_matters="w",
                 evidence=[Evidence(metric="phase1.x", value=1.0, label="x")])
    fix = Fix(fix_id="f." + pid, target={"type": target_type, "name": "master"},
              dsp_chain=[op], expected_outcome="o", sidechain=sidechain)
    return v.model_copy(update={"fix": fix, "confidence": conf,
                                "priority_score": prio, "problem_id": pid})


def test_translates_eq_and_limiter_preserves_order():
    eq_op = DspOp(type="peaking_eq", params={"frequency_hz": 300.0, "gain_db": -3.0, "q": 1.0})
    lim_op = DspOp(type="limiter", params={"ceiling_db": -1.0, "release_ms": 100.0, "lookahead_ms": 2.0})
    out = compile_preset([
        _vfix("frequency_balance.mud_buildup.0", eq_op),
        _vfix("clipping.clipping_count.0", lim_op),
    ])
    chain = out["chain"]
    assert chain["order"] == R.ORDER
    assert chain["modules"]["limiter"]["enabled"] is True
    assert chain["modules"]["limiter"]["ceilingDb"] == -1.0
    assert chain["modules"]["limiter"]["releaseMs"] == 100.0
    assert chain["modules"]["eq"]["enabled"] is True
    assert any(b["enabled"] and b["gainDb"] == -3.0 for b in chain["modules"]["eq"]["bands"])
    assert "comp" not in chain["modules"]  # untouched modules omitted


def test_four_limiters_collapse_to_one():
    ceilings = [-1.0, -1.5, -0.5, -2.0]
    confs = [0.80, 0.95, 0.90, 0.85]
    vs = [
        _vfix(f"clipping.s{i}.0",
              DspOp(type="limiter", params={"ceiling_db": c, "release_ms": 100.0, "lookahead_ms": 2.0}),
              conf=cf)
        for i, (c, cf) in enumerate(zip(ceilings, confs))
    ]
    out = compile_preset(vs)
    # one limiter; the ceiling is a SAFETY param — the LOWEST wins, never a
    # weighted average and never the highest-confidence fix (weighted-merge).
    assert out["chain"]["modules"]["limiter"]["ceilingDb"] == -2.0
    assert any("limiter" in c["module"] and "4" in c["change"] for c in out["change_log"])


def test_stereo_width_maps_to_ms_ratio():
    op = DspOp(type="stereo_width", params={"width_pct": 90.0})
    out = compile_preset([_vfix("stereo_field.over_widened.0", op)])
    ms = out["chain"]["modules"]["ms"]
    assert ms["width"] == 0.9
    assert "monoMakerHz" not in ms  # a plain width op must not write a stray mono-maker


def test_stereo_width_with_mono_maker_writes_mono_maker_hz():
    op = DspOp(type="stereo_width", params={"width_pct": 90.0, "mono_below_hz": 120.0})
    out = compile_preset([_vfix("stereo_field.negative_correlation.0", op)])
    ms = out["chain"]["modules"]["ms"]
    assert ms["width"] == 0.9 and ms["monoMakerHz"] == 120.0


def test_sidechain_op_diverts_to_leftover_advice():
    sc = DspOp(type="sidechain", params={"depth_db": 6.0, "release_ms": 140.0})
    out = compile_preset([_vfix("low_end.kick_bass.0", sc)])
    assert "ms" not in out["chain"]["modules"] and "comp" not in out["chain"]["modules"]
    assert len(out["leftover_advice"]) == 1
    assert out["leftover_advice"][0]["problem_id"] == "low_end.kick_bass.0"


def test_stem_target_diverts_to_leftover_advice():
    op = DspOp(type="peaking_eq", params={"frequency_hz": 300.0, "gain_db": -3.0, "q": 1.0})
    out = compile_preset([_vfix("low_end.x.0", op, target_type="stem")])
    assert "eq" not in out["chain"]["modules"]
    assert len(out["leftover_advice"]) == 1


def test_empty_input_returns_base_chain():
    out = compile_preset([])
    assert out["chain"]["order"] == R.ORDER
    assert out["chain"]["modules"] == {}
    assert out["leftover_advice"] == []


# ── Same-region EQ collision — opposite directions NET by weight ─────────────

def test_eq_opposite_directions_net_by_weight():
    boost = DspOp(type="peaking_eq", params={"frequency_hz": 300.0, "gain_db": 3.0, "q": 1.0})
    cut = DspOp(type="peaking_eq", params={"frequency_hz": 300.0, "gain_db": -3.0, "q": 1.0})
    # Weighted-merge formula: opposite directions in one region net via
    # weighted mean (weight = priority x confidence), not winner-take-all.
    # w(boost)=50*0.9=45, w(cut)=50*0.8=40 -> (3*45 - 3*40)/85 = +0.18.
    out = compile_preset([
        _vfix("frequency_balance.boost.0", boost, conf=0.9),
        _vfix("frequency_balance.cut.0", cut, conf=0.8),
    ])
    enabled = [b for b in out["chain"]["modules"]["eq"]["bands"] if b["enabled"]]
    assert len(enabled) == 1
    assert abs(enabled[0]["gainDb"] - 0.18) < 0.01
    assert any("netted" in c["change"] for c in out["change_log"])


def test_eq_far_apart_regions_always_coexist():
    # A low-region cut and a high-region boost never compete — both survive.
    out = compile_preset([
        _vfix("low_end.rumble.0",
              DspOp(type="peaking_eq", params={"frequency_hz": 100.0, "gain_db": -4.0, "q": 1.0}),
              prio=200),
        _vfix("frequency_balance.air.0",
              DspOp(type="peaking_eq", params={"frequency_hz": 8000.0, "gain_db": 2.0, "q": 1.0}),
              prio=20),
    ])
    enabled = [b for b in out["chain"]["modules"]["eq"]["bands"] if b["enabled"]]
    assert len(enabled) == 2
    assert enabled[0]["gainDb"] == -4.0 and enabled[1]["gainDb"] == 2.0


# ── trim: a constraint, not an accumulation (2026-07-27) ─────────────────────

def _trim(pid, gain_db, *, prio=50):
    return _vfix(pid, DspOp(type="gain", params={"gain_db": gain_db}), prio=prio)


def test_same_direction_trims_keep_the_binding_move_not_the_sum():
    # Three records observing ONE too-hot master each ask for roughly the same
    # cut. Summing them would land the track at -8.2 dB; the binding cut is -3.7.
    out = compile_preset([
        _trim("loudness.loudness_vs_target.0", -2.5, prio=120),
        _trim("clipping.true_peak_overshoot.0", -3.7, prio=200),
        _trim("clipping.clipping_count.0", -2.0, prio=90),
    ])
    assert out["chain"]["modules"]["trim"]["gainDb"] == -3.7
    assert any("binding" in c["change"] for c in out["change_log"])


def test_opposing_trims_net_by_weight():
    out = compile_preset([
        _trim("loudness.too_loud.0", -4.0, prio=200),
        _trim("loudness.too_quiet.0", 2.0, prio=50),
    ])
    # weights 200*.9 vs 50*.9 -> (-4*180 + 2*45)/225 = -2.8
    assert abs(out["chain"]["modules"]["trim"]["gainDb"] - (-2.8)) < 0.01
    assert any("disagree on direction" in c["why"] for c in out["change_log"])


def test_single_trim_passes_through_unchanged():
    out = compile_preset([_trim("loudness.loudness_vs_target.0", -3.1)])
    assert out["chain"]["modules"]["trim"]["gainDb"] == -3.1
