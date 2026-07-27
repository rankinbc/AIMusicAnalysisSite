"""Weighted fix-combining math — MIRROR of the frontend's
``components/frontend-spectr-v2/src/features/listen-rack/combineFixes.ts``.

The agreed formula (2026-07-27): when N fixes merge into one rack, every fix
contributes with weight = priority_score x confidence; moves merge only where
they genuinely overlap.

  EQ      gain moves (peaking + shelves) cluster by log-frequency — moves
          <= half an octave apart merge; farther apart ALWAYS coexist.
          Per cluster: weighted-geometric-mean frequency; same-direction
          gains SUM (capped +6/-9 dB); opposite directions NET via weighted
          mean; Q widens to span the cluster. High/low-pass cutoffs merge
          among themselves. Past the rack's 8 bands, highest total weight
          wins; losers are logged, never silently dropped.
  trim    a CONSTRAINT, not an accumulation — see ``merge_trims``.
  comp    weighted mean per param; ratio capped at 4:1.
  ms      width weighted mean, clamped 50-120%; mono_below_hz = max.
  limiter SAFETY param — lowest ceiling wins, never an average.

Change a rule here -> change it in combineFixes.ts too (and vice-versa).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

# Do-no-harm budgets (single source; coach_mix.interactions re-exports these).
EQ_MAX_TOTAL_BOOST_DB: float = 6.0
MAX_CUT_DEPTH_DB: float = 9.0
MAX_CUMULATIVE_GAIN_DB: float = 24.0
COMP_RATIO_CAP: float = 4.0
WIDTH_PCT_BOUNDS: tuple[float, float] = (50.0, 120.0)
# Moves farther apart than this never merge — they're different problems.
CLUSTER_HALF_OCTAVES: float = 0.5
RACK_EQ_SLOTS: int = 8


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def fix_weight(priority_score: int | float, confidence: float) -> float:
    """Merge weight — priority (~20-300 raw scale) x confidence (0-1)."""
    p = clamp(float(priority_score), 1.0, 300.0)
    c = clamp(float(confidence), 0.05, 1.0)
    return p * c


def wmean(pairs: list[tuple[float, float]]) -> float:
    """Weighted mean of (value, weight) pairs."""
    tw = sum(w for _, w in pairs)
    if tw <= 0:
        return sum(v for v, _ in pairs) / (len(pairs) or 1)
    return sum(v * w for v, w in pairs) / tw


def wgeomean(pairs: list[tuple[float, float]]) -> float:
    """Weighted geometric mean — frequency lives on a log scale."""
    tw = sum(w for _, w in pairs)
    if tw <= 0:
        return math.exp(sum(math.log(v) for v, _ in pairs) / (len(pairs) or 1))
    return math.exp(sum(math.log(v) * w for v, w in pairs) / tw)


def _fmt_hz(f: float) -> str:
    return (f"{f / 1000:.1f}k" if f >= 1000 else f"{round(f)}") + "Hz"


def _fmt_db(g: float) -> str:
    return f"{'+' if g >= 0 else ''}{g:.1f}dB"


@dataclass
class EqMove:
    """One eq-family gain move, weighted. ``kind`` is the rack band type
    (peaking/lowshelf/highshelf)."""
    kind: str
    freq: float
    gain: float
    q: float
    w: float
    source: str | None = None  # problem_id for change-log attribution


@dataclass
class MergedBand:
    """A merged rack eq band + the cluster's total weight (slot ranking).
    ``mixed``/``gains``/``rep_source`` let the arbiter raise a judgment call
    and attribute the merged move to its highest-weight contributor."""
    type: str
    freq: float
    gain_db: float
    q: float
    weight: float
    sources: list[str | None]
    gains: list[float]
    mixed: bool = False
    rep_source: str | None = None


def cluster_gain_moves(moves: list[EqMove], log: list[dict[str, Any]]) -> list[MergedBand]:
    """Cluster by log-frequency (anchored at each cluster's lowest move) and
    merge per the formula. Deterministic and order-independent."""
    if not moves:
        return []
    ordered = sorted(moves, key=lambda m: (m.freq, m.gain))
    max_ratio = 2.0 ** CLUSTER_HALF_OCTAVES
    clusters: list[list[EqMove]] = []
    for m in ordered:
        if clusters and m.freq / clusters[-1][0].freq <= max_ratio:
            clusters[-1].append(m)
        else:
            clusters.append([m])

    out: list[MergedBand] = []
    for c in clusters:
        total_w = sum(m.w for m in c)
        freq = wgeomean([(m.freq, m.w) for m in c])
        same_dir = all(m.gain >= 0 for m in c) or all(m.gain <= 0 for m in c)
        if same_dir:
            summed = sum(m.gain for m in c)
            gain = clamp(summed, -MAX_CUT_DEPTH_DB, EQ_MAX_TOTAL_BOOST_DB)
            if len(c) > 1:
                note = f"summed {len(c)} same-direction moves @{_fmt_hz(freq)} -> {_fmt_db(gain)}"
                if gain != summed:
                    note += f" (capped from {_fmt_db(summed)})"
                log.append({"module": "eq", "change": note, "why": "same frequency region"})
        else:
            gain = clamp(wmean([(m.gain, m.w) for m in c]),
                         -MAX_CUT_DEPTH_DB, EQ_MAX_TOTAL_BOOST_DB)
            log.append({
                "module": "eq",
                "change": f"netted {' vs '.join(_fmt_db(m.gain) for m in c)} @{_fmt_hz(freq)} -> {_fmt_db(gain)}",
                "why": "opposite directions in one region — weights arbitrated",
            })
        fmin, fmax = c[0].freq, c[-1].freq
        # One merged band must cover every original target: widen Q to the
        # cluster's span instead of leaving a narrow notch between the sources.
        if fmax > fmin:
            q = clamp(freq / (fmax - fmin), 0.4, 4.0)
        else:
            q = clamp(wmean([(m.q, m.w) for m in c]), 0.3, 12.0)
        top = max(c, key=lambda m: m.w)
        out.append(MergedBand(type=top.kind, freq=round(freq, 1), gain_db=round(gain, 2),
                              q=round(q, 2), weight=total_w, sources=[m.source for m in c],
                              gains=[m.gain for m in c], mixed=not same_dir,
                              rep_source=top.source))
    return out


def merge_filters(kind: str, entries: list[tuple[float, float, float]],
                  log: list[dict[str, Any]],
                  sources: list[str | None]) -> MergedBand | None:
    """Merge high/low-pass cutoffs: (freq, q, w) -> one band, weighted-geo-mean
    cutoff. ``kind`` is 'highpass' | 'lowpass'."""
    if not entries:
        return None
    freq = wgeomean([(f, w) for f, _, w in entries])
    q = clamp(wmean([(q_, w) for _, q_, w in entries]), 0.3, 4.0)
    if len(entries) > 1:
        log.append({"module": "eq", "change": f"merged {len(entries)} {kind} cutoffs -> {_fmt_hz(freq)}",
                    "why": "one filter per direction"})
    return MergedBand(type=kind, freq=round(freq, 1), gain_db=0.0, q=round(q, 2),
                      weight=sum(w for _, _, w in entries), sources=sources,
                      gains=[0.0] * len(entries))


@dataclass
class MergedTrim:
    """Result of ``merge_trims``. ``mixed`` is True when cuts and boosts were both
    asked for — a genuine disagreement, not a merge, so callers escalate it."""
    gain_db: float
    mixed: bool
    gains: list[float]
    sources: list[str | None]


def merge_trims(entries: list[tuple[float, float, str | None]],
                log: list[dict[str, Any]]) -> MergedTrim | None:
    """Merge master-trim moves. ``entries`` are (gain_db, weight, source).

    The master trim is ONE constraint — "put the output at the right level" —
    not a stack of independent gain-staging steps. Three records that each
    observe the same too-hot master (loudness over target, true peak over the
    ceiling, clipping) each ask for a cut of roughly the same size; summing them
    triple-corrects and lands the track 8 dB under where anyone wanted it. So
    within one direction the BINDING requirement wins — the deepest cut, the
    largest boost — exactly like the limiter's lowest-ceiling-wins rule.

    Cuts against boosts is a real contradiction rather than an overlap: those
    net by weight and set ``mixed`` so the arbiter can put the question to the
    producer instead of quietly splitting the difference.
    """
    if not entries:
        return None
    gains = [g for g, _, _ in entries]
    sources = [s for _, _, s in entries]
    cuts = [g for g in gains if g < 0]
    boosts = [g for g in gains if g > 0]
    mixed = bool(cuts and boosts)
    if mixed:
        gain = wmean([(g, w) for g, w, _ in entries])
        log.append({
            "module": "trim",
            "change": f"netted {' vs '.join(_fmt_db(g) for g in gains)} -> {_fmt_db(gain)}",
            "why": "trims disagree on direction — weights arbitrated",
        })
    else:
        # Binding requirement, not a sum. min() for cuts, max() for boosts.
        gain = min(gains) if cuts else max(gains)
        if len(entries) > 1:
            log.append({
                "module": "trim",
                "change": f"{len(entries)} trims agree on direction "
                          f"({', '.join(_fmt_db(g) for g in gains)}) -> kept binding {_fmt_db(gain)}",
                "why": "master level is one constraint — the deepest requirement satisfies the rest",
            })
    gain = clamp(gain, -MAX_CUMULATIVE_GAIN_DB, MAX_CUMULATIVE_GAIN_DB)
    return MergedTrim(gain_db=round(gain, 2), mixed=mixed, gains=gains, sources=sources)


def cap_bands(bands: list[MergedBand], log: list[dict[str, Any]]) -> list[MergedBand]:
    """Enforce the rack's slot budget: highest total weight wins, losers are
    logged. Result is sorted by frequency."""
    kept = bands
    if len(bands) > RACK_EQ_SLOTS:
        ranked = sorted(bands, key=lambda b: (-b.weight, b.freq))
        for lost in ranked[RACK_EQ_SLOTS:]:
            log.append({
                "module": "eq",
                "change": f"dropped @{_fmt_hz(lost.freq)} {_fmt_db(lost.gain_db)}",
                "why": f"rack has {RACK_EQ_SLOTS} bands — lowest weight lost",
            })
        kept = ranked[:RACK_EQ_SLOTS]
    return sorted(kept, key=lambda b: b.freq)
