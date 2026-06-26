"""End-to-end: problems -> solve() -> a valid rack chain with the expected
modules enabled and a non-empty change log.
"""
from __future__ import annotations

from aimusic_shared.verdicts.models import Evidence
from app.solve_lib import rack_schema as R
from app.solve_lib import solve
from app.verdict_lib.rule_engine import _problem


def _p(slug, category, metric, value, data_tier="audio_only"):
    return _problem(
        track_id="t", slug=slug, severity="severe", category=category,
        headline="h", summary="s", why_it_matters="w", data_tier=data_tier,
        evidence=[Evidence(metric=metric, value=value, label="x")],
    )


def test_solve_problems_to_chain():
    a = {
        "track_id": "t",
        "phase1": {"true_peak_db": 0.4, "bands": {"low_mid": -10.0, "mid": -20.0}, "stereo_width": 0.6},
        "phase2": {"genre": "techno"},
    }
    problems = [
        _p("true_peak_overshoot", "clipping", "phase1.true_peak_db", 0.4),
        _p("mud_buildup", "frequency_balance", "phase1.bands.low_mid", -10.0),
        _p("over_widened", "stereo_field", "phase1.stereo_width", 0.6),
    ]
    out = solve(problems, a)
    enabled = {m for m, s in out["chain"]["modules"].items() if s.get("enabled")}
    assert {"limiter", "eq", "ms"} <= enabled
    assert out["chain"]["order"] == R.ORDER
    assert len(out["change_log"]) >= 3


def test_solve_empty_problems():
    out = solve([], {"track_id": "t"})
    assert out["chain"]["modules"] == {}
