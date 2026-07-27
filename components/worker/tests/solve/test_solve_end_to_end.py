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


# ── stems tier: a per-stem problem reaches its OWN chain, not the master ─────

def _stems_analysis():
    """A mix that is both too loud AND has a pad swamping the bass in the
    low-mids — one master problem and one stem problem in the same run."""
    return {
        "track_id": "t",
        "phase1": {"lufs": -7.0},
        "phase2": {"genre": "modern_trance"},
        "phase4": {"stems": {
            "status": "ok",
            "clash_matrix": [{
                "stem_a": "bass", "stem_b": "pad", "role_a": "bass", "role_b": "pad",
                "band": "low_mid", "overlap_severity": 0.7, "severity_tier": "critical",
            }],
            "balance_flags": [{
                "role": "pad", "metric": "rms_db", "observed": -8.0,
                "expected_range": [-20.0, -14.0], "direction": "too_high",
                "severity_tier": "warning",
            }],
            "per_stem": {"pad": {"rms_db": -8.0}, "bass": {"rms_db": -16.0}},
        }},
    }


def test_stem_problems_compile_into_a_per_stem_chain():
    a = _stems_analysis()
    out = solve(
        [
            _p("loudness_vs_target", "loudness", "phase1.lufs", -7.0),
            _p("stem_clash", "frequency_collision", "phase4.stems.status", None,
               data_tier="stems"),
            _p("stem_balance", "gain_staging", "phase4.stems.per_stem.pad.rms_db", -8.0,
               data_tier="stems"),
        ],
        a,
    )

    # The master keeps its own move and ONLY its own move.
    assert out["chain"]["modules"]["trim"]["gainDb"] < 0
    assert "eq" not in out["chain"]["modules"]

    # The pad gets a chain of its own: a low-mid carve and a level cut.
    pad = next(t for t in out["targets"] if t["target"]["name"] == "pad")
    assert pad["target"]["type"] == "stem"
    assert any(b["enabled"] and b["freq"] == 320.0 and b["gainDb"] < 0
               for b in pad["chain"]["modules"]["eq"]["bands"])
    assert pad["chain"]["modules"]["trim"]["gainDb"] == -9.0

    # Nothing was silently dropped on the way.
    assert out["leftover_advice"] == []


def test_same_frequency_on_two_targets_never_merges():
    """A 320 Hz carve on the master and a 320 Hz carve on the pad are different
    instructions. Clustering them would sum two unrelated moves."""
    a = _stems_analysis()
    a["phase1"]["bands"] = {"low_mid": -10.0, "mid": -20.0}  # -> master mud carve
    out = solve(
        [
            _p("mud_buildup", "frequency_balance", "phase1.bands.low_mid", -10.0),
            _p("stem_clash", "frequency_collision", "phase4.stems.status", None,
               data_tier="stems"),
        ],
        a,
    )
    master_eq = [b for b in out["chain"]["modules"]["eq"]["bands"] if b["enabled"]]
    pad = next(t for t in out["targets"] if t["target"]["name"] == "pad")
    pad_eq = [b for b in pad["chain"]["modules"]["eq"]["bands"] if b["enabled"]]
    assert len(master_eq) == 1 and len(pad_eq) == 1
    # Both survive at their own depth — neither is the sum of the two.
    assert master_eq[0]["gainDb"] != pad_eq[0]["gainDb"] or master_eq[0]["gainDb"] > -6.0
