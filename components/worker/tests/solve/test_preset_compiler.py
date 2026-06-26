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
    # one limiter, the highest-confidence one (0.95 -> ceiling -1.5)
    assert out["chain"]["modules"]["limiter"]["ceilingDb"] == -1.5
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


# ── Phase 1: same-slot EQ collision — equal magnitude, a cut beats a boost ────

def test_eq_equal_magnitude_cut_beats_boost():
    boost = DspOp(type="peaking_eq", params={"frequency_hz": 300.0, "gain_db": 3.0, "q": 1.0})
    cut = DspOp(type="peaking_eq", params={"frequency_hz": 300.0, "gain_db": -3.0, "q": 1.0})
    # Boost is authored first (higher confidence -> processed first), then the
    # equal-magnitude cut. On a tie the corrective cut must win the band slot.
    out = compile_preset([
        _vfix("frequency_balance.boost.0", boost, conf=0.9),
        _vfix("frequency_balance.cut.0", cut, conf=0.8),
    ])
    enabled = [b for b in out["chain"]["modules"]["eq"]["bands"] if b["enabled"]]
    assert len(enabled) == 1 and enabled[0]["gainDb"] == -3.0
