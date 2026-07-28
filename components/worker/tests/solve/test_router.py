"""Router: route each problem to a solver by (category, data_tier), then merge
(attach validated fixes). Suppression already happened upstream in
evaluate_problems; the LLM refine stage is out of scope.
"""
from __future__ import annotations

from aimusic_shared.verdicts.models import Evidence
from app.solve_lib import router as Rt
from app.verdict_lib.rule_engine import _problem


def _p(slug, category, *, data_tier="audio_only", fixable=True, metric="phase1.x", value=1.0):
    return _problem(
        track_id="t", slug=slug, severity="severe", category=category,
        headline="h", summary="s", why_it_matters="w", data_tier=data_tier, fixable=fixable,
        evidence=[Evidence(metric=metric, value=value, label="x")],
    )


def test_route_by_category_and_tier():
    assert Rt.route(_p("clipping_count", "clipping")) == "clipping"
    assert Rt.route(_p("mud_buildup", "frequency_balance")) == "frequency_balance"
    assert Rt.route(_p("over_widened", "stereo_field")) == "stereo_field"


def test_route_returns_none_for_unmapped_tier_or_category():
    assert Rt.route(_p("robotic_velocity", "humanization", data_tier="project_midi")) is None
    # A category that exists at audio_only but has no stems-tier solver.
    assert Rt.route(_p("mud_buildup", "frequency_balance", data_tier="stems")) is None


def test_stems_tier_routes_to_the_per_stem_solvers():
    assert Rt.route(_p("stem_clash", "frequency_collision", data_tier="stems")) == "stem_clash"
    assert Rt.route(_p("stem_balance", "gain_staging", data_tier="stems")) == "stem_balance"


def test_observations_not_routed():
    assert Rt.route(_p("modal_ambiguity", "harmonic", fixable=False)) is None


def test_merge_attaches_validated_fix_only_to_routed():
    a = {"track_id": "t", "phase1": {"true_peak_db": 0.4}, "phase2": {"genre": "techno"}}
    clip = _p("true_peak_overshoot", "clipping", metric="phase1.true_peak_db", value=0.4)
    obs = _p("modal_ambiguity", "harmonic", fixable=False,
             metric="phase1.true_peak_db", value=0.4)

    out = Rt.merge([clip, obs], a, "techno")

    routed = next(p for p in out if p.category == "clipping")
    passed = next(p for p in out if p.category == "harmonic")
    assert routed.fix is not None and routed.fix.dsp_chain[0].type == "limiter"
    assert passed.fix is None  # observation passes through unsolved


# ── Phase 4: new audio-only categories route; dynamics stays advice ──────────

def test_route_new_audio_only_categories():
    assert Rt.route(_p("sub_mono_compatibility", "mono_compatibility")) == "mono_compatibility"
    assert Rt.route(_p("negative_correlation", "stereo_phase")) == "stereo_phase"
    assert Rt.route(_p("congested_mix", "clarity")) == "clarity"


def test_dynamics_not_routed():
    # un-squashing over-compression / loudness_war is not a master-rack move.
    assert Rt.route(_p("over_compression", "dynamics")) is None
    assert Rt.route(_p("loudness_war", "dynamics")) is None
