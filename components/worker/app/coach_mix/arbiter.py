"""Deterministic Coach Mix arbiter: NEED -> COMBINE -> SCAFFOLD -> GUARD.

Consumes the freshly-merged candidate fixes (Verdicts with a single-op Fix) and
returns reconciled Verdicts ready for solve_lib.preset_compiler, plus the
judgment calls the LLM must rule on and a human-readable change_log.
"""
from __future__ import annotations

from typing import Any

from aimusic_shared.verdicts.models import DspOp, Evidence, Fix, Verdict

from app.coach_mix import interactions as I
from app.coach_mix.types import ArbiterResult, JudgmentCall
from app.solve_lib import weighted_merge as W
from app.solve_lib.rack_schema import DSPTYPE_TO_MODULE, EQ_BAND_TYPE
from app.verdict_lib import genre_config as G
from app.verdict_lib.rule_engine import _problem

# Rack band type -> DspOp type (reverse of rack_schema.EQ_BAND_TYPE).
_BAND_TO_DSPTYPE = {band: op for op, band in EQ_BAND_TYPE.items()}


def _single_op(v: Verdict) -> DspOp:
    return v.fix.dsp_chain[0]


def _with_op(v: Verdict, op: DspOp) -> Verdict:
    return v.model_copy(update={"fix": v.fix.model_copy(update={"dsp_chain": [op]})})


def _need(verdicts: list[Verdict]) -> list[Verdict]:
    kept: list[Verdict] = []
    for v in verdicts:
        if v.severity in I.NEED_FLOOR_SEVERITIES and v.category not in I.UNIVERSAL_CATEGORIES:
            continue
        kept.append(v)
    # Highest priority first — later passes treat the head as the representative.
    return sorted(kept, key=lambda v: v.priority_score, reverse=True)


def _combine(verdicts: list[Verdict], change_log: list[dict[str, Any]]
             ) -> tuple[list[Verdict], list[JudgmentCall]]:
    calls: list[JudgmentCall] = []
    eq_pairs: list[tuple[Verdict, DspOp]] = []   # peaking + shelves (gain moves)
    gain_pairs: list[Verdict] = []
    passthrough: list[Verdict] = []              # incl. hp/lp — compiler merges filters

    for v in verdicts:
        op = _single_op(v)
        module = DSPTYPE_TO_MODULE.get(op.type)
        if module == "eq" and op.type in ("peaking_eq", "low_shelf", "high_shelf"):
            eq_pairs.append((v, op))
        elif module == "trim":
            gain_pairs.append(v)
        else:
            passthrough.append(v)

    # Weighted log-frequency clustering (solve_lib.weighted_merge — the same
    # formula the frontend's combineFixes.ts applies to the manual queue):
    # far-apart moves always coexist; same-region same-direction sums (capped);
    # opposite directions NET by weight, escalated as a judgment call.
    merged_eq: list[Verdict] = []
    if eq_pairs:
        by_pid = {v.problem_id: v for v, _ in eq_pairs}
        moves = [
            W.EqMove(kind=EQ_BAND_TYPE[op.type],
                     freq=W.clamp(float(op.params["frequency_hz"]), 20.0, 22000.0),
                     gain=float(op.params.get("gain_db", 0.0)),
                     q=float(op.params.get("q", 1.0)),
                     w=W.fix_weight(v.priority_score, v.confidence),
                     source=v.problem_id)
            for v, op in eq_pairs
        ]
        for band in W.cluster_gain_moves(moves, change_log):
            rep = by_pid.get(band.rep_source) or eq_pairs[0][0]
            merged_eq.append(_with_op(rep, DspOp(
                type=_BAND_TO_DSPTYPE[band.type],
                params={"frequency_hz": band.freq, "gain_db": band.gain_db, "q": band.q})))
            if band.mixed:
                calls.append(JudgmentCall(
                    kind="eq_conflict", where=f"eq cluster @{int(band.freq)}Hz",
                    competing_fix_ids=[s or "" for s in band.sources],
                    context={"gains_db": band.gains, "netted_db": band.gain_db},
                    question="A boost and a cut target the same region — netted by "
                             "weight; keep the net, or pick one side?"))

    out: list[Verdict] = merged_eq + passthrough
    if gain_pairs:
        clamped, total = I.clamp_gain_total([_single_op(v) for v in gain_pairs])
        rep = max(gain_pairs, key=lambda v: v.priority_score)
        out.append(_with_op(rep, clamped[0]))
        if len(gain_pairs) > 1:
            change_log.append({"module": "trim", "change": f"summed {len(gain_pairs)} trims -> {total}dB",
                               "why": "cumulative gain staging"})
    return out, calls


def _scaffold_verdict(slug: str, category: str, op: DspOp, outcome: str) -> Verdict:
    # Build via _problem so every required Verdict field is set correctly. These
    # verdicts are EPHEMERAL — they only flow into compile_preset to build the
    # chain; they are never persisted as Verdict rows, so source/specialist are
    # irrelevant. Attach the fix via model_copy.
    v = _problem(
        track_id="master", slug=slug, severity="minor", category=category,
        headline=outcome[:120], summary=outcome, why_it_matters="release-ready finishing",
        data_tier="audio_only", fixable=True,
        evidence=[Evidence(metric="phase1.lufs", value=0.0, label="scaffold")],
    )
    return v.model_copy(update={"fix": Fix(
        fix_id=f"fix.coach_mix.{slug}", target={"type": "master", "name": "master"},
        dsp_chain=[op], expected_outcome=outcome)})


def _scaffold(verdicts: list[Verdict], analysis: dict[str, Any], genre: str | None,
              change_log: list[dict[str, Any]]) -> tuple[list[Verdict], list[JudgmentCall]]:
    out = list(verdicts)
    calls: list[JudgmentCall] = []
    present = {DSPTYPE_TO_MODULE.get(_single_op(v).type) for v in verdicts}
    ctx = G.master_context()

    # Always finish with a true-peak ceiling limiter.
    if "limiter" not in present:
        ceiling = float(G.ppath(genre, f"loudness.{ctx}.true_peak_dbtp_max", -1.0))
        out.append(_scaffold_verdict("ceiling", "clipping",
                   DspOp(type="limiter", params={"ceiling_db": max(-6.0, min(0.0, ceiling)),
                                                  "release_ms": 100.0, "lookahead_ms": 2.0}),
                   f"Hold true peak at {ceiling:.1f} dBTP."))
        change_log.append({"module": "limiter", "change": "added ceiling (proactive)",
                           "why": "release-ready finishing"})

    # Loudness trim toward target when over and no trim already present.
    lufs = (analysis.get("phase1") or {}).get("lufs")
    if "trim" not in present and lufs is not None:
        target = G.ppath(genre, f"loudness.{ctx}.lufs_target") or G.ppath(genre, "loudness.streaming.lufs_target", -14.0)
        delta = float(target) - float(lufs)
        if delta < 0:
            out.append(_scaffold_verdict("loudness", "loudness",
                       DspOp(type="gain", params={"gain_db": max(-24.0, min(0.0, delta))}),
                       f"Trim {delta:.1f} dB toward {float(target):.0f} LUFS."))
            change_log.append({"module": "trim", "change": "added loudness trim (proactive)",
                               "why": "release-ready finishing"})

    # Offer glue as a judgment call (never forced) when the mix is clean.
    if "comp" not in present:
        calls.append(JudgmentCall(kind="glue_offer", where="bus comp",
                     competing_fix_ids=[], context={"lufs": lufs},
                     question="Would gentle bus-comp glue help, or is this clean mix better left untouched?"))
    return out, calls


def _guard(verdicts: list[Verdict], change_log: list[dict[str, Any]]
           ) -> tuple[list[Verdict], list[JudgmentCall]]:
    out: list[Verdict] = []
    calls: list[JudgmentCall] = []
    for v in verdicts:
        op = _single_op(v)
        if op.type in ("peaking_eq", "low_shelf", "high_shelf"):
            g = float(op.params.get("gain_db", 0.0))
            clamped = max(-I.MAX_CUT_DEPTH_DB, min(I.EQ_MAX_TOTAL_BOOST_DB, g))
            if clamped != g:
                op = DspOp(type=op.type, params={**op.params, "gain_db": round(clamped, 2)})
                v = _with_op(v, op)
                change_log.append({"module": "eq", "change": f"clamped gain {g}->{clamped}",
                                   "why": "do-no-harm budget"})
        elif op.type == "compressor":
            r = float(op.params.get("ratio", 2.0))
            if r > I.COMP_RATIO_CAP:
                op = DspOp(type="compressor", params={**op.params, "ratio": I.COMP_RATIO_CAP})
                v = _with_op(v, op)
                change_log.append({"module": "comp", "change": f"capped ratio -> {I.COMP_RATIO_CAP}",
                                   "why": "do-no-harm budget"})
        elif op.type == "stereo_width":
            w = float(op.params.get("width_pct", 100.0))
            lo, hi = I.WIDTH_PCT_BOUNDS
            clamped = max(lo, min(hi, w))
            if clamped != w:
                op = DspOp(type="stereo_width", params={**op.params, "width_pct": clamped})
                v = _with_op(v, op)
                change_log.append({"module": "stereo_width",
                                   "change": f"clamped width_pct {w}->{clamped}",
                                   "why": "do-no-harm budget"})
        out.append(v)
    return out, calls


def run(verdicts: list[Verdict], analysis: dict[str, Any], genre: str | None) -> ArbiterResult:
    change_log: list[dict[str, Any]] = []
    needed = _need(verdicts)
    combined, calls_c = _combine(needed, change_log)
    scaffolded, calls_s = _scaffold(combined, analysis, genre, change_log)
    guarded, calls_g = _guard(scaffolded, change_log)
    return ArbiterResult(verdicts=guarded, judgment_calls=[*calls_c, *calls_s, *calls_g],
                         change_log=change_log)
