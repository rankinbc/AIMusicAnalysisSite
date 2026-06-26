"""Two-pass Problem engine harness: the _problem() builder, _tiered() severity
picker, and evaluate_problems (singles → composites → suppression). Registries
are injectable so tests don't touch the module-global rule set.
"""
from __future__ import annotations

from aimusic_shared.verdicts.models import Evidence

from app.verdict_lib import rule_engine as RE


def _ev():
    return [Evidence(metric="phase1.lufs", value=-1.0, label="x")]


def test_problem_builder_sets_problem_id_and_specialist():
    v = RE._problem(
        track_id="t", slug="true_peak_overshoot", severity="severe", category="clipping",
        headline="h", summary="s", evidence=_ev(), why_it_matters="w",
    )
    assert v.problem_id == "clipping.true_peak_overshoot.0"
    assert v.specialist == "rule_engine.true_peak_overshoot"
    assert v.source == "rule_engine"
    assert v.fix is None
    assert v.confidence == 0.9


def test_tiered_picks_hottest_matching_band():
    bands = {"severe": 0.0, "moderate": -0.3, "minor": -1.0}
    assert RE._tiered(0.5, bands, higher_is_worse=True) == "severe"
    assert RE._tiered(-0.1, bands, higher_is_worse=True) == "moderate"
    assert RE._tiered(-2.0, bands, higher_is_worse=True) is None


def test_evaluate_problems_two_pass_with_suppression():
    def s_big(a):
        return RE._problem(track_id="t", slug="big", severity="moderate", category="dynamics",
                           headline="h", summary="s", evidence=_ev(), why_it_matters="w")

    def c_comp(a, fired):
        if "big" not in fired:
            return None
        return RE._problem(track_id="t", slug="loudness_war", severity="severe",
                           category="dynamics", headline="h", summary="s", evidence=_ev(),
                           why_it_matters="w")

    out = RE.evaluate_problems(
        {"track_id": "t"},
        singles=[("big", s_big)],
        composites=[("loudness_war", ["big"], c_comp)],
    )
    slugs = {v.problem_id.split(".")[1] for v in out}
    assert slugs == {"loudness_war"}  # composite fired and absorbed "big"


def test_evaluate_problems_empty_registry_returns_empty():
    assert RE.evaluate_problems({"track_id": "t"}, singles=[], composites=[]) == []


# ── Global-registry guard: clean baseline silent, engine alive on faults ─────
# These run the FULL module registry (every @single + @composite), not an
# injected set — the production invariant from rules.md: "never emit when in
# range." If a newly added rule fires on the clean reference, its threshold is
# wrong, not the fixture.

def test_clean_baseline_emits_no_problems(clean_trance):
    assert RE.evaluate_problems(clean_trance) == []


def test_engine_alive_on_known_faults(clipped_pop):
    # The clean-baseline guard only means something if the engine isn't dead.
    slugs = {v.problem_id.split(".")[1]
             for v in RE.evaluate_problems(clipped_pop)}
    assert "clipping_count" in slugs and "true_peak_overshoot" in slugs
