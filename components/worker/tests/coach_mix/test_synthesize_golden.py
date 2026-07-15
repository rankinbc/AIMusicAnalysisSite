"""Golden snapshot test — deterministic Coach Mix chain.

Stubs the LLM arbiter (``llm_arbiter.consult``) to a passthrough so the only
moving parts are the rule engine, router, solvers, and preset compiler.  The
expected enabled-module set is pinned to the first green run output — updating
it requires a deliberate golden-update decision (search for ``# GOLDEN``).

Pinned set  (first-run output, 2026-06-28):
    ['eq', 'limiter', 'trim']

To regenerate: delete the assert, run the test with ``-s``, read the printed
``enabled`` list, and restore the assert with the new set.
"""
from __future__ import annotations

from app.coach_mix import synthesize as S
from app.verdict_lib.rule_engine import evaluate_problems
from app.verdict_lib.flatten_analysis import flatten


def test_golden_deterministic_chain_is_stable(monkeypatch):
    """Chain module set must not drift without a deliberate golden update.

    Input fixture is intentionally problem-heavy (clipping + true-peak hot +
    loudness hot + mud build-up in bands) so that the test is sensitive to
    rule/solver/compiler regressions rather than only testing the happy path.
    """
    monkeypatch.setattr(S.llm_arbiter, "consult",
                        lambda res, a, g, **k: (res, None, False))
    final = {
        "phase1": {
            "clipping_detected": True,
            "clipped_sample_count": 999,
            "true_peak_db": -0.1,
            "lufs": -6.0,
            "bands": {"low_mid": -4.0, "mid": -10.0},
        },
        "phase2": {"genre": "techno"},
    }
    flat = flatten(final)
    flat["track_id"] = "t"
    out = S.synthesize(
        evaluate_problems(flat), flat,
        genre="techno", tier="free", user_id="u", correlation_id="c",
    )
    enabled = sorted(m for m, st in out["chain"]["modules"].items() if st.get("enabled"))
    # GOLDEN — changing this list requires a deliberate golden update (see module docstring)
    assert enabled == ["eq", "limiter", "trim"]
