from aimusic_shared.verdicts.models import DspOp, Evidence, Fix
from app.verdict_lib.rule_engine import _problem
from app.coach_mix import arbiter, interactions as I
from app.coach_mix.types import ArbiterResult


def _fix_v(slug, category, op):
    v = _problem(track_id="t", slug=slug, severity="severe", category=category,
                 headline="h", summary="s", why_it_matters="w", data_tier="audio_only",
                 fixable=True, evidence=[Evidence(metric="phase1.x", value=1.0, label="x")])
    return v.model_copy(update={"fix": Fix(fix_id=f"fix.{slug}", target={"type": "master", "name": "master"},
                                           dsp_chain=[op], expected_outcome="o")})


def test_guard_clamps_over_budget_cut():
    deep = _fix_v("mud", "frequency_balance",
                  DspOp(type="peaking_eq", params={"frequency_hz": 300.0, "gain_db": -20.0, "q": 1.0}))
    out, _ = arbiter._guard([deep], [])
    assert out[0].fix.dsp_chain[0].params["gain_db"] == -I.MAX_CUT_DEPTH_DB


def test_run_returns_arbiterresult_and_always_finishes_a_master():
    v = _fix_v("mud", "frequency_balance",
               DspOp(type="peaking_eq", params={"frequency_hz": 300.0, "gain_db": -2.0, "q": 1.0}))
    res = arbiter.run([v], {"phase1": {"lufs": -8.0}, "phase2": {"genre": "techno"}}, "techno")
    assert isinstance(res, ArbiterResult)
    types = {x.fix.dsp_chain[0].type for x in res.verdicts}
    assert "limiter" in types                # scaffold finished the master
    assert res.change_log                     # decisions recorded
    assert any(jc["kind"] == "glue_offer" for jc in res.judgment_calls)


def test_guard_caps_compressor_ratio():
    v = _fix_v("glue", "dynamics",
               DspOp(type="compressor", params={"ratio": 6.0, "threshold_db": -12.0}))
    out, _ = arbiter._guard([v], [])
    assert out[0].fix.dsp_chain[0].params["ratio"] == I.COMP_RATIO_CAP


def test_guard_clamps_stereo_width_and_logs():
    # DspOp stereo_width width_pct range is (0.0, 200.0); WIDTH_PCT_BOUNDS hi is 120.0.
    # 150.0 is within DspOp range but above the hi bound → clamped to 120.0.
    v = _fix_v("wide", "stereo_field",
               DspOp(type="stereo_width", params={"width_pct": 150.0}))
    log: list = []
    out, _ = arbiter._guard([v], log)
    lo, hi = I.WIDTH_PCT_BOUNDS
    assert out[0].fix.dsp_chain[0].params["width_pct"] == hi
    assert any(e["module"] == "stereo_width" for e in log)
