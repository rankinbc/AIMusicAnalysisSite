"""Preset compiler — merged Fix[] -> a rack ``chain`` the Listen rack can load.

Translates an already-decided set of fixes into the rack's module format; it does
not diagnose or invent fixes. Stages (PRPs/identifiers/preset-compiler.md):

  1. FILTER    keep master/bus fixes; divert stem-targeted + sidechain-bearing
               fixes to leftover advice.
  2. TRANSLATE each DspOp -> a rack module write (snake_case -> camelCase); ops
               with no master-rack home (sidechain, multiband) -> leftover advice.
  3. DEDUP     one module instance: limiter/comp/ms/trim collapse to the
               highest-(confidence, priority) fix; eq is additive across band
               slots (same-slot collision -> larger |gainDb| wins).
  4. ORDER     populate modules in place; never reorder the canonical chain.

Returns ``{"chain", "leftover_advice", "change_log"}``. Nothing is silently
dropped — every unmappable move comes back as advice.
"""
# NOTE: the frontend mirrors this op→rack-module mapping in
# components/frontend-spectr-v2/src/features/listen-rack/fixToRackPatch.ts
# for per-fix apply. Keep the two mappings in sync.
from __future__ import annotations

from typing import Any

from aimusic_shared.verdicts.models import DspOp, Verdict

from app.solve_lib.rack_schema import (
    DSPTYPE_TO_MODULE,
    EQ_BAND_TYPE,
    EQ_BANDS,
    ORDER,
    PARAM_MAP,
    nearest_band_slot,
)

_Pair = tuple[Verdict, DspOp]


def _rank(v: Verdict) -> tuple[float, int]:
    return (v.confidence, v.priority_score)


def _eq_stronger(new_gain: float, cur_gain: float) -> bool:
    """Does the new EQ move beat the one already in this slot? Larger magnitude
    wins; on equal magnitude a cut (more negative) beats a boost — a corrective
    cut is the safer / more intentional move than a boost of the same size."""
    if abs(new_gain) != abs(cur_gain):
        return abs(new_gain) > abs(cur_gain)
    return new_gain < cur_gain


def _base_chain() -> dict[str, Any]:
    return {"order": list(ORDER), "modules": {}, "masterBypass": False}


def _build_eq(pairs: list[_Pair], change_log: list[dict[str, Any]]) -> dict[str, Any]:
    bands: list[dict[str, Any]] = [
        {"type": "peaking", "freq": EQ_BANDS[i], "gainDb": 0.0, "q": 1.4, "enabled": False}
        for i in range(len(EQ_BANDS))
    ]
    for v, op in pairs:
        # Clamp to the audible band before slotting — an out-of-range frequency
        # must not index a wrong/edge EQ band.
        freq = max(20.0, min(22000.0, float(op.params["frequency_hz"])))
        gain = float(op.params.get("gain_db", 0.0))
        slot = nearest_band_slot(freq)
        cur = bands[slot]
        if cur["enabled"] and not _eq_stronger(gain, cur["gainDb"]):
            change_log.append({
                "module": "eq",
                "change": f"slot@{cur['freq']:.0f}Hz kept gainDb {cur['gainDb']}, dropped {gain}",
                "from_fix": v.problem_id, "why": "same band slot — stronger move wins",
            })
            continue
        bands[slot] = {
            "type": EQ_BAND_TYPE[op.type], "freq": freq, "gainDb": gain,
            "q": float(op.params.get("q", 1.0)), "enabled": True,
        }
        note = f"band@{freq:.0f}Hz {EQ_BAND_TYPE[op.type]} gainDb {gain}"
        if op.type in ("high_pass", "low_pass"):
            note += " (eq band has a fixed slope; solver slope_db not applied)"
        change_log.append({"module": "eq", "change": note,
                           "from_fix": v.problem_id, "why": op.type})
    return {"enabled": True, "bands": bands}


def _build_single(mod: str, pairs: list[_Pair], change_log: list[dict[str, Any]]) -> dict[str, Any]:
    winner_v, winner_op = max(pairs, key=lambda vp: _rank(vp[0]))
    state: dict[str, Any] = {"enabled": True}
    if mod == "ms":
        state["width"] = float(winner_op.params["width_pct"]) / 100.0
        # Bass mono-maker (Phase 4): only when the solver asked for it, so a plain
        # width op doesn't write a stray monoMakerHz.
        if "mono_below_hz" in winner_op.params:
            state["monoMakerHz"] = float(winner_op.params["mono_below_hz"])
    else:
        pmap = PARAM_MAP[mod]
        for k, val in winner_op.params.items():
            if k in pmap:
                state[pmap[k]] = val
    if len(pairs) > 1:
        change_log.append({
            "module": mod,
            "change": f"merged {len(pairs)} {mod} fixes (kept highest-confidence)",
            "from_fix": winner_v.problem_id, "why": "one module instance per rack",
        })
    else:
        change_log.append({"module": mod, "change": f"set {mod}",
                           "from_fix": winner_v.problem_id, "why": winner_op.type})
    return state


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
    for mod in ("comp", "limiter", "ms", "trim"):
        if mod in buckets:
            modules[mod] = _build_single(mod, buckets[mod], change_log)

    return {"chain": chain, "leftover_advice": leftover, "change_log": change_log}
