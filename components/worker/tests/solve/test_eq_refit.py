"""EQ refit — restating a merged curve in the fewest bands that reproduce it.

The parity test is the important one: this refit and the frontend's eqRefit.ts
must land on the SAME bands, or the rack the user auditions and the plan they
apply describe different processing. Both run the identical pattern search, so
the expected values below were taken from the TypeScript implementation and are
asserted here to 0.01.
"""
from __future__ import annotations

import math

from app.solve_lib.eq_refit import (
    Band,
    DEFAULT_TOLERANCE_DB,
    band_response_db,
    refit_gain_bands,
)


def _peak(freq: float, gain: float, q: float = 1.0) -> Band:
    return Band(type="peaking", freq=freq, gain_db=gain, q=q)


def _curve(bands: list[Band], n: int = 200) -> list[float]:
    """Finer grid than the fitter optimised against — no free pass."""
    freqs = [20.0 * (1000.0 ** (i / (n - 1))) for i in range(n)]
    return [sum(band_response_db(b, f) for b in bands) for f in freqs]


def _worst_gap(a: list[Band], b: list[Band]) -> float:
    return max(abs(x - y) for x, y in zip(_curve(a), _curve(b)))


# The crowded low end the merge actually produces on a bass-heavy master.
_CROWDED = [
    _peak(30, -2.5, 1.1), _peak(40, -2.0, 1.2), _peak(55, -1.5, 1.0),
    _peak(110, -2.2, 1.3), _peak(180, -1.8, 1.1), _peak(300, -2.6, 1.2),
    _peak(350, -1.4, 1.4),
]


def test_matches_the_frontend_refit_band_for_band():
    """Parity pin. These numbers came out of eqRefit.ts; if this test fails,
    the rack and the written plan have diverged and one of the two mirrors
    changed without the other."""
    res = refit_gain_bands(_CROWDED)
    assert (res.before, res.after) == (7, 3)
    assert abs(res.max_deviation_db - 0.284) < 0.01
    expected = [(36.6, -4.55, 0.83), (162.1, -3.61, 0.54), (328.0, -2.62, 1.75)]
    got = [(b.freq, b.gain_db, b.q) for b in res.bands]
    assert len(got) == len(expected)
    for (gf, gg, gq), (ef, eg, eq_) in zip(got, expected):
        assert abs(gf - ef) < 0.01 and abs(gg - eg) < 0.01 and abs(gq - eq_) < 0.01


def test_refit_holds_the_curve_on_an_independent_grid():
    res = refit_gain_bands(_CROWDED)
    assert _worst_gap(_CROWDED, res.bands) <= DEFAULT_TOLERANCE_DB * 1.5


def test_two_overlapping_cuts_are_one_move():
    res = refit_gain_bands([_peak(300, -2), _peak(330, -2)])
    assert res.after == 1
    assert 280 < res.bands[0].freq < 360


def test_genuinely_separate_problems_never_merge():
    original = [_peak(80, -4, 1.2), _peak(9000, 3, 0.8)]
    res = refit_gain_bands(original)
    assert res.after == 2
    assert _worst_gap(original, res.bands) <= DEFAULT_TOLERANCE_DB * 1.5


def test_filters_pass_through_untouched():
    hp = Band(type="highpass", freq=30, gain_db=0, q=0.7)
    res = refit_gain_bands([hp, _peak(300, -2), _peak(330, -2)])
    assert res.bands[0] is hp
    assert len([b for b in res.bands if b.type == "peaking"]) == 1


def test_nothing_to_gain_returns_the_input():
    one = [_peak(300, -3)]
    assert refit_gain_bands(one).bands == one
    assert refit_gain_bands([]).bands == []


def test_respects_the_do_no_harm_gain_budget():
    res = refit_gain_bands([_peak(200, -5, 0.8), _peak(240, -5, 0.8), _peak(280, -5, 0.8)])
    for b in res.bands:
        assert -9.0 <= b.gain_db <= 6.0


def test_is_deterministic():
    a = refit_gain_bands(_CROWDED)
    b = refit_gain_bands(_CROWDED)
    assert [(x.freq, x.gain_db, x.q) for x in a.bands] == [(x.freq, x.gain_db, x.q) for x in b.bands]


def test_band_response_matches_the_rbj_peaking_identity():
    """At its centre frequency a peaking band's gain IS its gain_db - the
    sanity check that the shared response math is the real biquad, not an
    approximation that would let the two mirrors drift."""
    b = _peak(1000, -3.0, 1.0)
    assert abs(band_response_db(b, 1000.0) - (-3.0)) < 0.05
    # ...and far away it is flat.
    assert abs(band_response_db(b, 20.0)) < 0.05
    assert not math.isnan(band_response_db(b, 20000.0))
