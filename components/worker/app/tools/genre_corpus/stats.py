"""Pure statistics for the genre-corpus tuner — no audio, no DB, fully testable."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from statistics import mean as _mean
from statistics import median as _median
from typing import Any


@dataclass(frozen=True)
class Summary:
    n: int
    median: float
    p10: float
    p90: float
    mean: float

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _percentile(sorted_vals: list[float], pct: float) -> float:
    """Linear-interpolation percentile (``pct`` in [0, 1]); input must be sorted."""
    if not sorted_vals:
        raise ValueError("percentile of empty sequence")
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    rank = pct * (len(sorted_vals) - 1)
    lo = int(rank)
    hi = min(lo + 1, len(sorted_vals) - 1)
    frac = rank - lo
    return sorted_vals[lo] * (1.0 - frac) + sorted_vals[hi] * frac


def summarize(values: list[float]) -> Summary:
    """Median / p10 / p90 / mean over the finite values (raises on empty)."""
    vals = sorted(float(v) for v in values if v is not None)
    if not vals:
        raise ValueError("summarize: no values")
    return Summary(
        n=len(vals),
        median=round(_median(vals), 4),
        p10=round(_percentile(vals, 0.10), 4),
        p90=round(_percentile(vals, 0.90), 4),
        mean=round(_mean(vals), 4),
    )


def aggregate(per_track: list[dict[str, float]]) -> dict[str, Summary]:
    """Per-metric ``Summary`` across a list of per-track metric dicts. None / NaN
    values are dropped; a metric with no finite values is skipped."""
    metrics: dict[str, list[float]] = {}
    for row in per_track:
        for key, val in row.items():
            if isinstance(val, (int, float)) and val == val:  # noqa: PLR0124 — NaN check
                metrics.setdefault(key, []).append(float(val))
    return {key: summarize(vals) for key, vals in metrics.items() if vals}
