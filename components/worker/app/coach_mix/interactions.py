"""Tuning constants + pure interaction helpers for the Coach Mix arbiter.

Genre-relative targets are resolved by the arbiter via genre_config; these are
the genre-agnostic safety budgets + the deterministic combine math.
"""
from __future__ import annotations

from aimusic_shared.verdicts.models import DspOp

# GUARD budgets now live in solve_lib.weighted_merge (single source, mirrored
# by the frontend's combineFixes.ts) — re-exported here for existing call sites.
from app.solve_lib.weighted_merge import (  # noqa: F401
    COMP_RATIO_CAP,
    EQ_MAX_TOTAL_BOOST_DB,
    MAX_CUMULATIVE_GAIN_DB,
    MAX_CUT_DEPTH_DB,
    WIDTH_PCT_BOUNDS,
)

# NEED: fixes below this severity are dropped unless their category is universal.
NEED_FLOOR_SEVERITIES: set[str] = {"win"}            # 'minor'+ always kept for now
UNIVERSAL_CATEGORIES: set[str] = {"clipping", "loudness"}


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def blend_eq(a: DspOp, b: DspOp) -> DspOp:
    """Blend two same-direction EQ ops in one slot: average freq, sum gain (capped).

    LEGACY (2026-07-27): the live combine path moved to
    ``solve_lib.weighted_merge.cluster_gain_moves`` (weighted, log-frequency
    clustering). Kept for its pairwise-blend tests only."""
    fa, fb = float(a.params["frequency_hz"]), float(b.params["frequency_hz"])
    ga, gb = float(a.params.get("gain_db", 0.0)), float(b.params.get("gain_db", 0.0))
    summed = ga + gb
    if summed >= 0:
        gain = _clamp(summed, 0.0, EQ_MAX_TOTAL_BOOST_DB)
    else:
        gain = _clamp(summed, -MAX_CUT_DEPTH_DB, 0.0)
    q = (float(a.params.get("q", 1.0)) + float(b.params.get("q", 1.0))) / 2.0
    return DspOp(type="peaking_eq", params={
        "frequency_hz": round((fa + fb) / 2.0, 1), "gain_db": round(gain, 2), "q": round(q, 2),
    })


def clamp_gain_total(ops: list[DspOp]) -> tuple[list[DspOp], float]:
    """Collapse N trim/gain ops into one, clamped to the cumulative-gain budget."""
    total = sum(float(o.params.get("gain_db", 0.0)) for o in ops)
    total = _clamp(total, -MAX_CUMULATIVE_GAIN_DB, MAX_CUMULATIVE_GAIN_DB)
    return [DspOp(type="gain", params={"gain_db": round(total, 2)})], round(total, 2)
