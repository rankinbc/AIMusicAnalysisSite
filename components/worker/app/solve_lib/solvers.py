"""Deterministic solvers — turn a Problem (Verdict) into a parameter-exact Fix.

Each solver reads the problem's measured fields from the (flattened) analysis +
genre-relative targets from ``genre_config``, and returns a ``Fix`` whose
``DspOp`` params are clamped to the model's ``_DSP_PARAM_RANGES`` (so Pydantic
never rejects them). A solver returns ``None`` when no master-rack move applies
(e.g. a too-quiet master, or an unknown slug) — the router leaves it unsolved.

MVP roster = the master-rack winners (audio_only). Stems/MIDI moves and the
"un-squash" of over-compression are leftover-advice, not rack moves.
"""
from __future__ import annotations

from typing import Any, Callable

from aimusic_shared.verdicts.models import DspOp, Fix, Verdict

from app.verdict_lib import genre_config as G


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _slug(v: Verdict) -> str:
    return v.problem_id.split(".")[1] if v.problem_id else ""


def _p1(a: dict[str, Any]) -> dict[str, Any]:
    return a.get("phase1") or {}


def _fix(v: Verdict, ops: list[DspOp], outcome: str, *, target_type: str = "master") -> Fix:
    return Fix(
        fix_id=f"fix.{v.problem_id or v.verdict_id}",
        target={"type": target_type, "name": "master"},
        dsp_chain=ops,
        expected_outcome=outcome,
    )


# ── clipping -> limiter ──────────────────────────────────────────────────────

def solve_clipping(v: Verdict, a: dict[str, Any], genre: str | None) -> Fix | None:
    ctx = G.master_context()
    ceiling = _clamp(float(G.ppath(genre, f"loudness.{ctx}.true_peak_dbtp_max", -1.0)), -6.0, 0.0)
    op = DspOp(type="limiter", params={
        "ceiling_db": ceiling, "release_ms": 100.0, "lookahead_ms": 2.0,
    })
    return _fix(v, [op], f"Hold true peak at {ceiling:.1f} dBTP without audible pumping.")


# ── loudness -> gain trim (only when too loud) ───────────────────────────────

def solve_loudness(v: Verdict, a: dict[str, Any], genre: str | None) -> Fix | None:
    lufs = _p1(a).get("lufs")
    if lufs is None:
        return None
    ctx = G.master_context()
    target = G.ppath(genre, f"loudness.{ctx}.lufs_target") or G.ppath(genre, "loudness.streaming.lufs_target", -14.0)
    delta = float(target) - float(lufs)
    if delta >= 0:  # at/under target — gaining a master UP isn't a safe rack move
        return None
    gain_db = _clamp(delta, -24.0, 0.0)
    op = DspOp(type="gain", params={"gain_db": gain_db})
    return _fix(v, [op], f"Trim {gain_db:.1f} dB to land near the {float(target):.0f} LUFS target.")


# ── frequency_balance -> eq cut / shelf boost ────────────────────────────────

def solve_frequency_balance(v: Verdict, a: dict[str, Any], genre: str | None) -> Fix | None:
    slug = _slug(v)
    bands = _p1(a).get("bands") or {}
    if slug == "mud_buildup":
        lm, mid = bands.get("low_mid"), bands.get("mid")
        if lm is None or mid is None:
            return None  # can't size the carve without both bands — leave unsolved
        gain = -_clamp((lm - mid) / 2.0, 0.0, 6.0)
        op = DspOp(type="peaking_eq", params={"frequency_hz": 300.0, "gain_db": gain, "q": 1.0})
        return _fix(v, [op], f"Carve {gain:.1f} dB at 300 Hz to clear low-mid mud.")
    if slug == "harsh_upper_mid":
        op = DspOp(type="peaking_eq", params={"frequency_hz": 3500.0, "gain_db": -3.0, "q": 1.0})
        return _fix(v, [op], "Soften 3.5 kHz by 3 dB to tame harshness.")
    if slug == "dull_no_air":
        op = DspOp(type="high_shelf", params={"frequency_hz": 10000.0, "gain_db": 3.0, "q": 0.7})
        return _fix(v, [op], "Lift a 3 dB high shelf at 10 kHz for air.")
    return None


# ── low_end -> shelf boost / high-pass ───────────────────────────────────────

def solve_low_end(v: Verdict, a: dict[str, Any], genre: str | None) -> Fix | None:
    slug = _slug(v)
    if slug == "sub_rumble":
        op = DspOp(type="high_pass", params={"frequency_hz": 30.0, "slope_db": 24.0})
        return _fix(v, [op], "High-pass at 30 Hz to clear sub rumble.")
    if slug == "thin_low_end":
        op = DspOp(type="low_shelf", params={"frequency_hz": 80.0, "gain_db": 3.0, "q": 0.7})
        return _fix(v, [op], "Lift a 3 dB low shelf at 80 Hz for body.")
    return None


# ── stereo_field -> width ────────────────────────────────────────────────────

def solve_stereo_field(v: Verdict, a: dict[str, Any], genre: str | None) -> Fix | None:
    slug = _slug(v)
    if slug not in ("over_widened", "phantom_width"):
        return None
    width_pct = 80.0 if slug == "phantom_width" else 90.0
    op = DspOp(type="stereo_width", params={"width_pct": width_pct})
    return _fix(v, [op], f"Pull stereo width to {width_pct:.0f}% to restore mono stability.")


# ── mono_compatibility / stereo_phase -> ms width + bass mono-maker ───────────
# Two symptoms of the same disease; when they co-occur with over-widening the
# `phantom_width` composite absorbs them (-> solve_stereo_field). These solvers
# handle the INDEPENDENT case. One DSP capability: a `mono_below_hz` param on the
# existing stereo_width op (the rack `ms` module already exposes monoMakerHz).

def _mono_below(genre: str | None) -> float:
    """Genre bass mono-maker crossover (Hz), clamped to the rack knob's [0, 400]."""
    return _clamp(float(G.ppath(genre, "stereo.mono_below_hz", 100.0)), 0.0, 400.0)


def solve_mono_compat(v: Verdict, a: dict[str, Any], genre: str | None) -> Fix | None:
    if _slug(v) != "sub_mono_compatibility":
        return None
    mono_hz = _mono_below(genre)
    op = DspOp(type="stereo_width", params={"width_pct": 100.0, "mono_below_hz": mono_hz})
    return _fix(v, [op], f"Mono the low end below {mono_hz:.0f} Hz so the sub survives a mono fold-down.")


def solve_stereo_phase(v: Verdict, a: dict[str, Any], genre: str | None) -> Fix | None:
    if _slug(v) != "negative_correlation":
        return None
    corr = _p1(a).get("stereo_correlation")
    # -1 correlation -> 60% width; 0 -> 90%. Mono-safe but not collapsed.
    width_pct = 80.0 if corr is None else _clamp(90.0 + float(corr) * 30.0, 60.0, 100.0)
    mono_hz = _mono_below(genre)
    op = DspOp(type="stereo_width", params={"width_pct": width_pct, "mono_below_hz": mono_hz})
    return _fix(v, [op], f"Narrow to {width_pct:.0f}% and mono below {mono_hz:.0f} Hz to recover phase coherence.")


# ── clarity -> conservative low-mid carve ────────────────────────────────────

def solve_clarity(v: Verdict, a: dict[str, Any], genre: str | None) -> Fix | None:
    if _slug(v) != "congested_mix":
        return None
    # congested_mix evidence carries no per-band delta -> a fixed conservative carve.
    # EQ alone won't fully de-congest (full separation needs stems); say so.
    op = DspOp(type="peaking_eq", params={"frequency_hz": 300.0, "gain_db": -2.5, "q": 1.0})
    return _fix(v, [op], "Carve 2.5 dB at 300 Hz to open congested low-mids; "
                         "full separation needs stem-level work.")


SOLVERS: dict[str, Callable[[Verdict, dict[str, Any], str | None], "Fix | None"]] = {
    "clipping": solve_clipping,
    "loudness": solve_loudness,
    "frequency_balance": solve_frequency_balance,
    "low_end": solve_low_end,
    "stereo_field": solve_stereo_field,
    "mono_compatibility": solve_mono_compat,
    "stereo_phase": solve_stereo_phase,
    "clarity": solve_clarity,
}
