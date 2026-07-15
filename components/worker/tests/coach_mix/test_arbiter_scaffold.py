from aimusic_shared.verdicts.models import DspOp, Evidence, Fix
from app.verdict_lib.rule_engine import _problem
from app.coach_mix import arbiter


def _fix_v(slug, category, op):
    v = _problem(track_id="t", slug=slug, severity="severe", category=category,
                 headline="h", summary="s", why_it_matters="w", data_tier="audio_only",
                 fixable=True, evidence=[Evidence(metric="phase1.x", value=1.0, label="x")])
    return v.model_copy(update={"fix": Fix(fix_id=f"fix.{slug}", target={"type": "master", "name": "master"},
                                           dsp_chain=[op], expected_outcome="o")})


def test_scaffold_adds_ceiling_limiter_when_absent(monkeypatch):
    monkeypatch.setattr(arbiter.G, "ppath",
        lambda genre, path, default=None: -10.0 if path.endswith("lufs_target")
        else (-1.0 if "true_peak" in path else default))
    a = {"phase1": {"lufs": -8.0}, "phase2": {"genre": "techno"}}
    out, _calls = arbiter._scaffold([], a, "techno", [])
    types = {v.fix.dsp_chain[0].type for v in out}
    assert "limiter" in types          # release-ready always finishes with a ceiling
    assert "gain" in types             # and a loudness trim toward target (-8 is over)


def test_scaffold_does_not_duplicate_existing_limiter():
    existing = _fix_v("clip", "clipping", DspOp(type="limiter", params={"ceiling_db": -1.0}))
    a = {"phase1": {"lufs": -14.0}, "phase2": {"genre": "techno"}}
    out, _calls = arbiter._scaffold([existing], a, "techno", [])
    limiters = [v for v in out if v.fix.dsp_chain[0].type == "limiter"]
    assert len(limiters) == 1          # not duplicated


def test_scaffold_offers_glue_as_judgment_call_only():
    a = {"phase1": {"lufs": -14.0}, "phase2": {"genre": "techno"}}
    out, calls = arbiter._scaffold([], a, "techno", [])
    assert all(v.fix.dsp_chain[0].type != "compressor" for v in out)  # never forced
    assert any(c["kind"] == "glue_offer" for c in calls)             # offered to LLM


def test_scaffold_genre_none_does_not_crash():
    out, _calls = arbiter._scaffold([], {"phase1": {"lufs": -8.0}}, None, [])
    assert any(v.fix.dsp_chain[0].type == "limiter" for v in out)


def test_scaffold_no_trim_when_under_target():
    a = {"phase1": {"lufs": -20.0}, "phase2": {"genre": "techno"}}
    out, _calls = arbiter._scaffold([], a, "techno", [])
    assert all(v.fix.dsp_chain[0].type != "gain" for v in out)


def test_scaffold_no_glue_offer_when_comp_present():
    comp = _fix_v("squash", "dynamics",
                  DspOp(type="compressor", params={"threshold_db": -18.0, "ratio": 2.0}))
    out, calls = arbiter._scaffold([comp], {"phase1": {"lufs": -14.0}, "phase2": {"genre": "techno"}}, "techno", [])
    assert not any(c["kind"] == "glue_offer" for c in calls)
