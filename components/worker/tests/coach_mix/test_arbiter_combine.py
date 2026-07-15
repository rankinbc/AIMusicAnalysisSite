from aimusic_shared.verdicts.models import DspOp, Evidence, Fix
from app.verdict_lib.rule_engine import _problem
from app.coach_mix import arbiter


def _fix_v(slug, category, op, *, severity="severe", conf=0.9):
    v = _problem(track_id="t", slug=slug, severity=severity, category=category,
                 headline="h", summary="s", why_it_matters="w", data_tier="audio_only",
                 fixable=True, evidence=[Evidence(metric="phase1.x", value=1.0, label="x")])
    fix = Fix(fix_id=f"fix.{slug}", target={"type": "master", "name": "master"},
              dsp_chain=[op], expected_outcome="o")
    return v.model_copy(update={"fix": fix, "confidence": conf})


def test_combine_blends_same_direction_eq_in_one_slot():
    a = _fix_v("mud_a", "frequency_balance",
               DspOp(type="peaking_eq", params={"frequency_hz": 300.0, "gain_db": -2.0, "q": 1.0}))
    b = _fix_v("mud_b", "clarity",
               DspOp(type="peaking_eq", params={"frequency_hz": 320.0, "gain_db": -2.0, "q": 1.0}))
    log: list = []
    out, calls = arbiter._combine([a, b], log)
    eqs = [v for v in out if v.fix.dsp_chain[0].type == "peaking_eq"]
    assert len(eqs) == 1                                   # blended into one
    assert eqs[0].fix.dsp_chain[0].params["gain_db"] == -4.0
    assert not calls                                       # same direction → no judgment call


def test_combine_escalates_opposite_direction_eq_clash():
    boost = _fix_v("air", "frequency_balance",
                   DspOp(type="peaking_eq", params={"frequency_hz": 300.0, "gain_db": 3.0, "q": 1.0}))
    cut = _fix_v("mud", "frequency_balance",
                 DspOp(type="peaking_eq", params={"frequency_hz": 300.0, "gain_db": -3.0, "q": 1.0}))
    log: list = []
    out, calls = arbiter._combine([boost, cut], log)
    assert any(c["kind"] == "eq_conflict" for c in calls)  # escalated to LLM
    # On equal-magnitude tie, the earlier (boost) is kept
    eqs = [v for v in out if v.fix.dsp_chain[0].type == "peaking_eq"]
    assert len(eqs) == 1
    assert eqs[0].fix.dsp_chain[0].params["gain_db"] == 3.0


def test_combine_keeps_different_slots_additive():
    low = _fix_v("low", "frequency_balance",
                 DspOp(type="peaking_eq", params={"frequency_hz": 120.0, "gain_db": -2.0, "q": 1.0}))
    high = _fix_v("high", "frequency_balance",
                  DspOp(type="peaking_eq", params={"frequency_hz": 8000.0, "gain_db": -2.0, "q": 1.0}))
    out, calls = arbiter._combine([low, high], [])
    assert len([v for v in out if v.fix.dsp_chain[0].type == "peaking_eq"]) == 2


def test_combine_conflict_keeps_stronger_move():
    weak_boost = _fix_v("weak_boost", "frequency_balance",
                        DspOp(type="peaking_eq", params={"frequency_hz": 300.0, "gain_db": 2.0, "q": 1.0}))
    strong_cut = _fix_v("strong_cut", "frequency_balance",
                        DspOp(type="peaking_eq", params={"frequency_hz": 300.0, "gain_db": -5.0, "q": 1.0}))
    log: list = []
    out, calls = arbiter._combine([weak_boost, strong_cut], log)
    # Strong cut (|5.0| > |2.0|) replaces the weaker boost
    eqs = [v for v in out if v.fix.dsp_chain[0].type == "peaking_eq"]
    assert len(eqs) == 1
    assert eqs[0].fix.dsp_chain[0].params["gain_db"] == -5.0
    assert any(c["kind"] == "eq_conflict" for c in calls)


def test_need_drops_win_severity_non_universal():
    keep = _fix_v("real", "frequency_balance",
                  DspOp(type="peaking_eq", params={"frequency_hz": 300.0, "gain_db": -2.0, "q": 1.0}),
                  severity="severe")
    drop = _fix_v("nit", "stereo_field",
                  DspOp(type="stereo_width", params={"width_pct": 95.0}), severity="win")
    kept = arbiter._need([keep, drop])
    slugs = {v.problem_id.split(".")[1] for v in kept}
    assert "real" in slugs and "nit" not in slugs


def test_need_sorts_by_priority_score_descending():
    severe_v = _fix_v("severe_case", "frequency_balance",
                      DspOp(type="peaking_eq", params={"frequency_hz": 300.0, "gain_db": -2.0, "q": 1.0}),
                      severity="severe")
    moderate_v = _fix_v("moderate_case", "frequency_balance",
                        DspOp(type="peaking_eq", params={"frequency_hz": 500.0, "gain_db": -1.0, "q": 1.0}),
                        severity="moderate")
    kept = arbiter._need([moderate_v, severe_v])
    # _need should sort by priority_score descending
    assert len(kept) == 2
    assert kept[0].priority_score >= kept[1].priority_score
