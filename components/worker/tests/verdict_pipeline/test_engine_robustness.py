"""Phase 1 robustness: the two-pass engine isolates a throwing rule so one bad
metric type (or a buggy composite) can't wipe the whole batch of findings."""
from __future__ import annotations

from app.verdict_lib import rule_engine as RE


def _over_compressed():
    # Same shape test_composites uses to fire over_compression.
    return {"track_id": "t", "phase1": {
        "crest_factor": 3.0, "loudness_range_lu": 2.9, "true_peak_db": -0.1,
        "lufs": -8.0, "clipping_detected": False}}


def _boom_single(_a):
    raise TypeError("bad metric type")


def _boom_composite(_a, _fired):
    raise ValueError("bad composite")


def test_throwing_single_does_not_kill_batch():
    a = _over_compressed()
    out = RE.evaluate_problems(
        a,
        singles=[("boom", _boom_single), ("over_compression", RE.over_compression)],
        composites=[],
    )
    slugs = {v.problem_id.split(".")[1] for v in out}
    assert "over_compression" in slugs  # survived despite the throwing sibling


def test_throwing_composite_does_not_kill_batch():
    a = _over_compressed()
    out = RE.evaluate_problems(
        a,
        singles=[("over_compression", RE.over_compression)],
        composites=[("boom", [], _boom_composite)],
    )
    slugs = {v.problem_id.split(".")[1] for v in out}
    assert "over_compression" in slugs  # the throwing composite is skipped, single survives
