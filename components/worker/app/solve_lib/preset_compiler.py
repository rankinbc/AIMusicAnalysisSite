"""Preset compiler — merged Fix[] -> a rack ``chain`` the Listen rack can load.

Translates an already-decided set of fixes into the rack's module format; it does
not diagnose or invent fixes. Stages (PRPs/identifiers/preset-compiler.md):

  1. FILTER    keep master/bus fixes; divert stem-targeted + sidechain-bearing
               fixes to leftover advice.
  2. TRANSLATE each DspOp -> a rack module write (snake_case -> camelCase); ops
               with no master-rack home (sidechain, multiband) -> leftover advice.
  3. MERGE     the weighted formula (solve_lib.weighted_merge — mirrored by the
               frontend's combineFixes.ts): every fix pulls with weight =
               priority x confidence. EQ clusters by log-frequency (same-
               direction sums capped, opposite directions net); comp/ms params
               weighted-average; same-direction trims keep the BINDING move
               (the master level is one constraint, not a stack of steps); the
               limiter keeps the LOWEST ceiling (safety). Nothing merges across
               frequency regions.
  3b. REFIT    restate the merged curve in the fewest bands that reproduce it
               (solve_lib.eq_refit - mirrored by the frontend's eqRefit.ts).
               Runs before the slot cap, and before the chain forks into the
               audition rack and the written plan, so both describe the same
               processing.
  4. ORDER     populate modules in place; never reorder the canonical chain.

Returns ``{"chain", "leftover_advice", "change_log"}``. Nothing is silently
dropped — every unmappable move comes back as advice, every merge is logged.
"""
# NOTE: the frontend mirrors this op→rack-module mapping in
# components/frontend-spectr-v2/src/features/listen-rack/fixToRackPatch.ts
# (per-fix apply) and the merge math in .../combineFixes.ts. Keep them in sync.
from __future__ import annotations

import math
from typing import Any

from aimusic_shared.verdicts.models import DspOp, Verdict

from app.solve_lib.rack_schema import (
    DSPTYPE_TO_MODULE,
    EQ_BAND_TYPE,
    EQ_BANDS,
    ORDER,
    PARAM_MAP,
)
from app.solve_lib import eq_refit as R
from app.solve_lib import weighted_merge as W

_Pair = tuple[Verdict, DspOp]


def _w(v: Verdict) -> float:
    return W.fix_weight(v.priority_score, v.confidence)


def _base_chain() -> dict[str, Any]:
    return {"order": list(ORDER), "modules": {}, "masterBypass": False}


def _num(params: dict[str, Any], key: str, fallback: float) -> float:
    val = params.get(key, fallback)
    try:
        return float(val)
    except (TypeError, ValueError):
        return fallback


def _refit_merged(bands: list[W.MergedBand],
                  change_log: list[dict[str, Any]]) -> list[W.MergedBand]:
    """Refit the clustered gain bands to the fewest holding the same curve, and
    re-attach merge weights: a synthesised band inherits the pull of the
    original moves it stands in for (nearest in log-frequency), so the slot cap
    downstream still ranks by how hard the source fixes pulled, and the
    change-log keeps every contributing problem_id."""
    filters = [b for b in bands if b.type in ("highpass", "lowpass")]
    gains = [b for b in bands if b.type not in ("highpass", "lowpass")]
    if len(gains) < 2:
        return bands

    res = R.refit_gain_bands([
        R.Band(type=b.type, freq=b.freq, gain_db=b.gain_db, q=b.q) for b in gains
    ])
    if res.after >= res.before:
        return bands

    rewrapped = [
        W.MergedBand(type=b.type, freq=b.freq, gain_db=b.gain_db, q=b.q,
                     weight=0.0, sources=[], gains=[])
        for b in res.bands if b.type not in ("highpass", "lowpass")
    ]
    for src in gains:
        nearest = min(rewrapped,
                      key=lambda c: abs(math.log(src.freq) - math.log(c.freq)))
        nearest.weight += src.weight
        nearest.sources.extend(src.sources)
        nearest.gains.extend(src.gains)
        if nearest.rep_source is None:
            nearest.rep_source = src.rep_source
        # A refit band standing in for a contested cluster is still contested.
        nearest.mixed = nearest.mixed or src.mixed

    change_log.append({
        "module": "eq",
        "change": f"{res.before} bands restated as {res.after} - same curve to within "
                  f"{res.max_deviation_db} dB",
        "why": "fewest bands a human can carry into a DAW",
    })
    return filters + rewrapped


def _build_eq(pairs: list[_Pair], change_log: list[dict[str, Any]]) -> dict[str, Any]:
    gain_moves: list[W.EqMove] = []
    hp: list[tuple[float, float, float]] = []
    lp: list[tuple[float, float, float]] = []
    hp_src: list[str | None] = []
    lp_src: list[str | None] = []
    for v, op in pairs:
        # Clamp to the audible band before merging — an out-of-range frequency
        # must not skew a cluster.
        freq = W.clamp(_num(op.params, "frequency_hz", 1000.0), 20.0, 22000.0)
        w = _w(v)
        if op.type == "high_pass":
            hp.append((freq, _num(op.params, "q", 0.7), w))
            hp_src.append(v.problem_id)
        elif op.type == "low_pass":
            lp.append((freq, _num(op.params, "q", 0.7), w))
            lp_src.append(v.problem_id)
        else:
            gain_moves.append(W.EqMove(
                kind=EQ_BAND_TYPE[op.type], freq=freq,
                gain=_num(op.params, "gain_db", 0.0), q=_num(op.params, "q", 1.0),
                w=w, source=v.problem_id))

    merged = [
        b for b in (
            W.merge_filters("highpass", hp, change_log, hp_src),
            W.merge_filters("lowpass", lp, change_log, lp_src),
            *W.cluster_gain_moves(gain_moves, change_log),
        ) if b is not None
    ]
    # Restate the curve in as few bands as reproduce it, BEFORE the slot cap so
    # nothing is dropped that the refit would have absorbed for free — and
    # before the chain forks into the audition rack and the written plan, so
    # both describe the same processing. Mirrors combineFixes.refitMerged.
    merged = _refit_merged(merged, change_log)
    merged = W.cap_bands(merged, change_log)

    bands: list[dict[str, Any]] = [
        {"type": "peaking", "freq": EQ_BANDS[i], "gainDb": 0.0, "q": 1.4, "enabled": False}
        for i in range(len(EQ_BANDS))
    ]
    for i, b in enumerate(merged):
        bands[min(i, len(bands) - 1)] = {
            "type": b.type, "freq": b.freq, "gainDb": b.gain_db, "q": b.q, "enabled": True,
        }
        note = f"band@{b.freq:.0f}Hz {b.type} gainDb {b.gain_db}"
        if b.type in ("highpass", "lowpass"):
            note += " (eq band has a fixed slope; solver slope_db not applied)"
        # A refit band can end up representing no original directly (every
        # source landed nearer a sibling), so sources may be empty here.
        change_log.append({"module": "eq", "change": note,
                           "from_fix": (b.sources[0] if b.sources else b.rep_source),
                           "why": "weighted merge"})
    return {"enabled": True, "bands": bands}


def _rep(pairs: list[_Pair]) -> Verdict:
    """Highest-weight member — change-log attribution for a merged module."""
    return max(pairs, key=lambda vp: _w(vp[0]))[0]


def _build_comp(pairs: list[_Pair], change_log: list[dict[str, Any]]) -> dict[str, Any]:
    def pick(key: str, fallback: float) -> float:
        return W.wmean([(_num(op.params, key, fallback), _w(v)) for v, op in pairs])

    state: dict[str, Any] = {"enabled": True}
    pmap = PARAM_MAP["comp"]
    defaults = {"threshold_db": 0.0, "ratio": 1.0, "attack_ms": 3.0,
                "release_ms": 250.0, "knee_db": 30.0, "makeup_gain_db": 0.0}
    present = {k for _, op in pairs for k in op.params if k in pmap}
    for k in present:
        val = pick(k, defaults[k])
        if k == "ratio":
            val = min(val, W.COMP_RATIO_CAP)
        state[pmap[k]] = round(val, 2)
    if len(pairs) > 1:
        change_log.append({
            "module": "comp",
            "change": f"weighted-averaged {len(pairs)} comp settings (ratio cap {W.COMP_RATIO_CAP}:1)",
            "from_fix": _rep(pairs).problem_id, "why": "one module instance per rack",
        })
    else:
        change_log.append({"module": "comp", "change": "set comp",
                           "from_fix": _rep(pairs).problem_id, "why": "compressor"})
    return state


def _build_limiter(pairs: list[_Pair], change_log: list[dict[str, Any]]) -> dict[str, Any]:
    # Safety param: the lowest ceiling always wins — never averaged.
    ceiling = min(_num(op.params, "ceiling_db", -1.0) for _, op in pairs)
    state: dict[str, Any] = {
        "enabled": True,
        "ceilingDb": round(W.clamp(ceiling, -6.0, 0.0), 2),
        "releaseMs": round(W.wmean([(_num(op.params, "release_ms", 50.0), _w(v)) for v, op in pairs]), 1),
        "lookaheadMs": round(W.wmean([(_num(op.params, "lookahead_ms", 5.0), _w(v)) for v, op in pairs]), 1),
    }
    if len(pairs) > 1:
        change_log.append({
            "module": "limiter",
            "change": f"merged {len(pairs)} limiter fixes — kept lowest ceiling {ceiling}dB (safety)",
            "from_fix": _rep(pairs).problem_id, "why": "one module instance per rack",
        })
    else:
        change_log.append({"module": "limiter", "change": "set limiter",
                           "from_fix": _rep(pairs).problem_id, "why": "limiter"})
    return state


def _build_ms(pairs: list[_Pair], change_log: list[dict[str, Any]]) -> dict[str, Any]:
    width_pct = W.clamp(
        W.wmean([(_num(op.params, "width_pct", 100.0), _w(v)) for v, op in pairs]),
        *W.WIDTH_PCT_BOUNDS)
    state: dict[str, Any] = {"enabled": True, "width": round(width_pct / 100.0, 2)}
    # Bass mono-maker: only when a solver asked for it; max = most conservative.
    monos = [_num(op.params, "mono_below_hz", 0.0) for _, op in pairs if "mono_below_hz" in op.params]
    if monos:
        state["monoMakerHz"] = max(monos)
    if len(pairs) > 1:
        change_log.append({
            "module": "ms",
            "change": f"weighted-averaged {len(pairs)} width settings -> {round(width_pct)}%",
            "from_fix": _rep(pairs).problem_id, "why": "one module instance per rack",
        })
    else:
        change_log.append({"module": "ms", "change": "set ms",
                           "from_fix": _rep(pairs).problem_id, "why": "stereo_width"})
    return state


def _build_trim(pairs: list[_Pair], change_log: list[dict[str, Any]]) -> dict[str, Any]:
    merged = W.merge_trims(
        [(_num(op.params, "gain_db", 0.0), _w(v), v.problem_id) for v, op in pairs],
        change_log)
    if merged is None:
        return {"enabled": True, "gainDb": 0.0}
    if len(pairs) == 1:
        change_log.append({"module": "trim", "change": "set trim",
                           "from_fix": _rep(pairs).problem_id, "why": "gain"})
    return {"enabled": True, "gainDb": merged.gain_db}


_MODULE_BUILDERS = {
    "comp": _build_comp,
    "limiter": _build_limiter,
    "ms": _build_ms,
    "trim": _build_trim,
}


def compile_preset(
    verdicts: list[Verdict], *, base: dict[str, Any] | None = None
) -> dict[str, Any]:
    leftover: list[dict[str, Any]] = []
    change_log: list[dict[str, Any]] = []
    buckets: dict[str, list[_Pair]] = {}

    for v in verdicts:
        fix = v.fix
        if fix is None:
            continue
        target_type = (fix.target or {}).get("type")
        if target_type not in ("master", "bus"):
            leftover.append({
                "problem_id": v.problem_id,
                "reason": f"target '{target_type}' is a per-element move, not a master rack",
                "instruction": fix.expected_outcome,
            })
            continue
        if fix.sidechain:
            leftover.append({
                "problem_id": v.problem_id,
                "reason": "per-element sidechain — not expressible as a master rack",
                "instruction": fix.expected_outcome,
            })
            continue
        for op in fix.dsp_chain:
            module = DSPTYPE_TO_MODULE.get(op.type)
            if module is None:
                leftover.append({
                    "problem_id": v.problem_id,
                    "reason": f"{op.type} has no master-rack module",
                    "instruction": fix.expected_outcome,
                })
                continue
            buckets.setdefault(module, []).append((v, op))

    chain = base if base is not None else _base_chain()
    modules: dict[str, Any] = chain["modules"]
    if "eq" in buckets:
        modules["eq"] = _build_eq(buckets["eq"], change_log)
    for mod, build in _MODULE_BUILDERS.items():
        if mod in buckets:
            modules[mod] = build(buckets[mod], change_log)

    return {"chain": chain, "leftover_advice": leftover, "change_log": change_log}
