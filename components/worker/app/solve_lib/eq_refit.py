"""EQ refit — restate a merged band set as the FEWEST bands producing the same
curve. MIRROR of the frontend's
``components/frontend-spectr-v2/src/features/listen-rack/eqRefit.ts``.

The merge stage answers "what do all these fixes add up to" in the merge's own
terms: one band per surviving cluster. Correct, and unreadable. Seven bands
across two octaves are, to within a fraction of a dB, three moves — and three
moves is something a producer can hold in their head and dial into a DAW.

It runs BEFORE the chain forks into the audition rack and the written
instructions, so what the user hears and what they're told to do are the same
processing. If the rack rendered seven bands and the guide listed three, the
audition would be worthless.

**Why a hand-rolled pattern search and not scipy.** The frontend runs this same
refit on the user's live fix queue, where there is no server round-trip and no
scipy. Two different optimisers would land on two different band sets for the
same input — exactly the rack-vs-guide divergence this stage exists to prevent.
So both sides run the identical derivative-free coordinate descent, with the
identical grid, ladders and round count. Change a constant here, change it
there too; ``tests/solve/test_eq_refit.py`` pins the shared output.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

FS = 44100.0
DEFAULT_TOLERANCE_DB = 0.3
GAIN_BOUNDS = (-9.0, 6.0)
Q_BOUNDS = (0.3, 12.0)
FREQ_BOUNDS = (20.0, 20000.0)
ROUNDS = 14
GRID_POINTS = 96


def _log_freqs(n: int, lo: float = 20.0, hi: float = 20000.0) -> list[float]:
    return [lo * (hi / lo) ** (i / (n - 1)) for i in range(n)]


GRID: list[float] = _log_freqs(GRID_POINTS)


@dataclass
class Band:
    """A rack EQ band. ``type`` is peaking / lowshelf / highshelf / highpass /
    lowpass — the same vocabulary the frontend's EqBand uses."""
    type: str
    freq: float
    gain_db: float
    q: float
    enabled: bool = True


def _coeffs(b: Band) -> tuple[float, ...] | None:
    """RBJ cookbook coefficients — matches eqResponse.ts, which in turn matches
    what Web Audio's BiquadFilterNode actually does (shelves at the spec's fixed
    S=1; hp/lp Q is interpreted in dB per the Web Audio spec)."""
    f0 = max(10.0, min(FS / 2 - 1, b.freq))
    w0 = 2 * math.pi * f0 / FS
    cosw, sinw = math.cos(w0), math.sin(w0)
    A = 10 ** (b.gain_db / 40)
    if b.type == "peaking":
        q = max(0.05, b.q)
        alpha = sinw / (2 * q)
        return (1 + alpha * A, -2 * cosw, 1 - alpha * A,
                1 + alpha / A, -2 * cosw, 1 - alpha / A)
    if b.type in ("lowshelf", "highshelf"):
        alpha = (sinw / 2) * math.sqrt((A + 1 / A) * (1 / 1 - 1) + 2)  # S=1
        s = 2 * math.sqrt(A) * alpha
        if b.type == "lowshelf":
            return (A * (A + 1 - (A - 1) * cosw + s),
                    2 * A * (A - 1 - (A + 1) * cosw),
                    A * (A + 1 - (A - 1) * cosw - s),
                    A + 1 + (A - 1) * cosw + s,
                    -2 * (A - 1 + (A + 1) * cosw),
                    A + 1 + (A - 1) * cosw - s)
        return (A * (A + 1 + (A - 1) * cosw + s),
                -2 * A * (A - 1 + (A + 1) * cosw),
                A * (A + 1 + (A - 1) * cosw - s),
                A + 1 - (A - 1) * cosw + s,
                2 * (A - 1 - (A + 1) * cosw),
                A + 1 - (A - 1) * cosw - s)
    if b.type in ("highpass", "lowpass"):
        q = 10 ** (b.q / 20)  # Web Audio hp/lp Q is in dB
        alpha = sinw / (2 * max(0.05, q))
        if b.type == "highpass":
            return ((1 + cosw) / 2, -(1 + cosw), (1 + cosw) / 2,
                    1 + alpha, -2 * cosw, 1 - alpha)
        return ((1 - cosw) / 2, 1 - cosw, (1 - cosw) / 2,
                1 + alpha, -2 * cosw, 1 - alpha)
    return None


def band_response_db(b: Band, f: float) -> float:
    """One band's magnitude response in dB at frequency ``f``."""
    if not b.enabled:
        return 0.0
    if b.gain_db == 0 and b.type not in ("highpass", "lowpass"):
        return 0.0
    c = _coeffs(b)
    if c is None:
        return 0.0
    b0, b1, b2, a0, a1, a2 = c
    w = 2 * math.pi * max(1.0, min(FS / 2 - 1, f)) / FS
    cw, c2w = math.cos(w), math.cos(2 * w)
    num = b0 * b0 + b1 * b1 + b2 * b2 + 2 * (b0 * b1 + b1 * b2) * cw + 2 * b0 * b2 * c2w
    den = a0 * a0 + a1 * a1 + a2 * a2 + 2 * (a0 * a1 + a1 * a2) * cw + 2 * a0 * a2 * c2w
    if den <= 0 or num < 0:
        return 0.0
    return 10 * math.log10(num / den)


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _is_filter(b: Band) -> bool:
    return b.type in ("highpass", "lowpass")


def _response_of(b: Band) -> list[float]:
    return [band_response_db(b, f) for f in GRID]


def _sum_into(curves: list[list[float]]) -> list[float]:
    out = [0.0] * len(GRID)
    for c in curves:
        for i in range(len(GRID)):
            out[i] += c[i]
    return out


def _sse(target: list[float], got: list[float]) -> float:
    return sum((t - g) ** 2 for t, g in zip(target, got))


def _max_dev(target: list[float], got: list[float]) -> float:
    return max(abs(t - g) for t, g in zip(target, got))


def _seed(originals: list[Band], k: int) -> list[Band]:
    """k strongest originals — a deterministic start already close to the answer,
    so the search refines rather than explores."""
    ranked = sorted(originals, key=lambda b: (-abs(b.gain_db), b.freq))[:k]
    return sorted(
        (Band(type="peaking", freq=b.freq, gain_db=b.gain_db, q=b.q) for b in ranked),
        key=lambda b: b.freq,
    )


def _fit(target: list[float], originals: list[Band], k: int) -> tuple[list[Band], float]:
    bands = _seed(originals, k)
    curves = [_response_of(b) for b in bands]
    total = _sum_into(curves)
    err = _sse(target, total)

    gain_step, freq_step, q_step = 1.5, 1.35, 1.6
    for _ in range(ROUNDS):
        for j in range(len(bands)):
            def _try(cand: Band, j: int = j) -> None:
                nonlocal total, err
                cand_curve = _response_of(cand)
                cand_sum = [total[i] + cand_curve[i] - curves[j][i] for i in range(len(GRID))]
                cand_err = _sse(target, cand_sum)
                if cand_err < err:
                    bands[j] = cand
                    curves[j] = cand_curve
                    total = cand_sum
                    err = cand_err

            for d in (1, -1):
                b = bands[j]
                _try(Band("peaking", b.freq, _clamp(b.gain_db + d * gain_step, *GAIN_BOUNDS), b.q))
                b = bands[j]
                _try(Band("peaking", _clamp(b.freq * (freq_step if d > 0 else 1 / freq_step),
                                            *FREQ_BOUNDS), b.gain_db, b.q))
                b = bands[j]
                _try(Band("peaking", b.freq, b.gain_db,
                          _clamp(b.q * (q_step if d > 0 else 1 / q_step), *Q_BOUNDS)))
        gain_step *= 0.62
        freq_step = 1 + (freq_step - 1) * 0.62
        q_step = 1 + (q_step - 1) * 0.62

    return bands, _max_dev(target, total)


@dataclass
class RefitResult:
    bands: list[Band]
    max_deviation_db: float
    before: int
    after: int


def refit_gain_bands(bands: list[Band],
                     tolerance_db: float = DEFAULT_TOLERANCE_DB) -> RefitResult:
    """Restate ``bands`` as the fewest bands matching the same response.

    High/low-pass filters pass through untouched — they aren't expressible as
    peaking bands, and a cutoff is an instruction in its own right. The result
    is never worse than the input: if no smaller set lands inside tolerance, the
    originals come back.
    """
    filters = [b for b in bands if _is_filter(b)]
    gains = [b for b in bands if not _is_filter(b) and b.enabled and b.gain_db != 0]
    unchanged = RefitResult(bands=bands, max_deviation_db=0.0,
                            before=len(gains), after=len(gains))
    if len(gains) < 2:
        return unchanged

    target = _sum_into([_response_of(b) for b in gains])
    for k in range(1, len(gains)):
        cand, dev = _fit(target, gains, k)
        if dev <= tolerance_db:
            return RefitResult(
                bands=filters + [
                    Band(type=b.type, freq=round(b.freq, 1), gain_db=round(b.gain_db, 2),
                         q=round(b.q, 2), enabled=True)
                    for b in cand
                ],
                max_deviation_db=round(dev, 3),
                before=len(gains),
                after=k,
            )
    return unchanged


def refit_rack_bands(rack_bands: list[dict[str, Any]],
                     log: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Adapter for the preset compiler's rack-band dicts (camelCase ``gainDb``).
    Returns the refit list, or the input untouched when nothing was gained."""
    parsed = [
        Band(type=str(b.get("type", "peaking")), freq=float(b.get("freq", 1000.0)),
             gain_db=float(b.get("gainDb", 0.0)), q=float(b.get("q", 1.0)),
             enabled=bool(b.get("enabled", True)))
        for b in rack_bands
    ]
    res = refit_gain_bands(parsed)
    if res.after >= res.before:
        return rack_bands
    log.append({
        "module": "eq",
        "change": f"{res.before} bands restated as {res.after} - same curve to within "
                  f"{res.max_deviation_db} dB",
        "why": "fewest bands a human can carry into a DAW",
    })
    return [
        {"type": b.type, "freq": b.freq, "gainDb": b.gain_db, "q": b.q, "enabled": True}
        for b in res.bands
    ]
