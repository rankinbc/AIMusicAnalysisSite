"""Deterministic solvers — turn a Problem (Verdict) into a parameter-exact Fix.

Each solver reads the problem's measured fields from the (flattened) analysis +
genre-relative targets from ``genre_config``, and returns a ``Fix`` whose
``DspOp`` params are clamped to the model's ``_DSP_PARAM_RANGES`` (so Pydantic
never rejects them). A solver returns ``None`` when no master-rack move applies
(e.g. a too-quiet master, or an unknown slug) — the router leaves it unsolved.

Roster: the master-rack winners (audio_only) plus the per-stem moves
(data_tier "stems"), whose fixes target ONE stem rather than the master — the
compiler fans those out into their own instruction block. The "un-squash" of
over-compression is still leftover advice, not a rack move.
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


def _fix(v: Verdict, ops: list[DspOp], outcome: str, *,
         target_type: str = "master", target_name: str = "master") -> Fix:
    return Fix(
        fix_id=f"fix.{v.problem_id or v.verdict_id}",
        target={"type": target_type, "name": target_name},
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


# ── stems -> per-stem moves (data_tier "stems") ──────────────────────────────
# These are the first solvers that DON'T target the master. Their fixes carry
# target {"type": "stem", "name": <role>}, which the preset compiler fans out
# into a per-stem instruction block instead of a master-rack write.

_BAND_CENTRE_HZ: dict[str, float] = {
    "sub": 40.0, "sub_bass": 40.0, "bass": 110.0, "low_mid": 320.0,
    "mid": 1000.0, "high_mid": 3500.0, "upper_mid": 3500.0,
    "presence": 8000.0, "air": 14000.0,
}

# Who keeps the band when two stems collide, and who gets carved to make room.
# Higher wins. Standard practice: the foundation and the focal element hold
# their range; supporting texture moves out of the way. Genre-agnostic for now
# — this belongs in genre-profiles.json (trance wants kick/bass over vocals,
# pop wants the reverse) and is the obvious next refinement.
_ROLE_PRIORITY: dict[str, int] = {
    "vocals": 100, "kick": 95, "bass": 90, "snare": 80, "lead": 70,
    "drums": 60, "hats": 50, "pad": 30, "other": 25, "fx": 20,
}


def _carve_depth_db(overlap: float) -> float:
    """Overlap severity (0-1) -> carve depth. Conservative: a clash is a
    reason to make room, not to gut the stem."""
    return -_clamp(1.5 + overlap * 3.0, 1.5, 4.5)


def solve_stem_clash(v: Verdict, a: dict[str, Any], genre: str | None) -> Fix | None:
    """Carve the lower-priority stem in the contested band. The fix targets that
    ONE stem — carving the master here would dip both sides and the element you
    wanted to keep loses too."""
    if _slug(v) != "stem_clash":
        return None
    stems = (a.get("phase4") or {}).get("stems") or {}
    rows = [r for r in (stems.get("clash_matrix") or [])
            if r.get("severity_tier") in ("warning", "critical")]
    if not rows:
        return None
    worst = max(rows, key=lambda r: (r.get("severity_tier") == "critical",
                                     float(r.get("overlap_severity") or 0.0)))
    a_name, b_name = str(worst.get("stem_a")), str(worst.get("stem_b"))
    a_role = str(worst.get("role_a") or a_name)
    b_role = str(worst.get("role_b") or b_name)
    # Lower priority gets carved; ties go to the alphabetically-later name so
    # the choice is deterministic rather than dict-order dependent.
    pa = _ROLE_PRIORITY.get(a_role, 40)
    pb = _ROLE_PRIORITY.get(b_role, 40)
    carve, keep = ((a_name, b_name) if (pa, a_name) < (pb, b_name) else (b_name, a_name))

    band = str(worst.get("band") or "")
    freq = _BAND_CENTRE_HZ.get(band)
    if freq is None:
        return None  # unknown band — don't invent a frequency
    gain = _carve_depth_db(float(worst.get("overlap_severity") or 0.0))
    op = DspOp(type="peaking_eq", params={"frequency_hz": freq, "gain_db": gain, "q": 1.4})
    return _fix(
        v, [op],
        f"Carve {gain:.1f} dB at {freq:.0f} Hz on {carve} to make room for {keep} in the {band} band.",
        target_type="stem", target_name=carve,
    )


def solve_stem_balance(v: Verdict, a: dict[str, Any], genre: str | None) -> Fix | None:
    """Re-gain the flagged stem to the middle of its expected window. Sized from
    the measurement, not a guess."""
    if _slug(v) != "stem_balance":
        return None
    stems = (a.get("phase4") or {}).get("stems") or {}
    flags = [f for f in (stems.get("balance_flags") or [])
             if f.get("severity_tier") in ("warning", "critical")]
    if not flags:
        return None
    worst = max(flags, key=lambda f: abs(float(f.get("observed") or 0.0)
                                         - _window_mid(f.get("expected_range"))))
    role = str(worst.get("role"))
    observed = float(worst.get("observed") or 0.0)
    gain = _clamp(_window_mid(worst.get("expected_range")) - observed, -12.0, 12.0)
    if abs(gain) < 0.5:
        return None  # already close enough — a sub-half-dB move is noise
    op = DspOp(type="gain", params={"gain_db": round(gain, 2)})
    direction = "up" if gain > 0 else "down"
    return _fix(
        v, [op],
        f"Bring {role} {direction} {abs(gain):.1f} dB to sit inside its expected range.",
        target_type="stem", target_name=role,
    )


def _window_mid(rng: Any) -> float:
    try:
        lo, hi = float(rng[0]), float(rng[1])
    except (TypeError, ValueError, IndexError):
        return 0.0
    return (lo + hi) / 2.0


SOLVERS: dict[str, Callable[[Verdict, dict[str, Any], str | None], "Fix | None"]] = {
    "clipping": solve_clipping,
    "loudness": solve_loudness,
    "frequency_balance": solve_frequency_balance,
    "low_end": solve_low_end,
    "stereo_field": solve_stereo_field,
    "mono_compatibility": solve_mono_compat,
    "stereo_phase": solve_stereo_phase,
    "clarity": solve_clarity,
    "stem_clash": solve_stem_clash,
    "stem_balance": solve_stem_balance,
}
