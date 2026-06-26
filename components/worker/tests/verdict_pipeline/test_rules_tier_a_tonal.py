"""Tier-A tonal/spectral rules A7-A12 — suspected, placeholder thresholds scaled
by the genre's qualitative spectral hints (no firing numbers in the profiles yet).
Default _a() trips none of them (clean baseline).
"""
from __future__ import annotations

from app.verdict_lib import rule_engine as RE
from app.verdict_lib.validator import validate_verdict


def _bands(**over):
    b = {"sub_bass": -20.0, "bass": -18.0, "low_mid": -22.0, "mid": -20.0,
         "upper_mid": -45.0, "presence": -55.0, "air": -65.0}
    b.update(over)
    return b


def _a(genre: str = "trance", **p1) -> dict:
    base = {"low_energy": 0.2, "spectral_flatness": 0.2, "key_detection_confidence": 0.9,
            "spectral_centroid_hz": 3000.0, "stereo_width": 0.3, "bands": _bands()}
    base.update(p1)
    return {"track_id": "t", "phase1": base, "phase2": {"genre": genre}}


def test_thin_low_end_fires_and_silent():
    v = RE.thin_low_end(_a(low_energy=0.05))
    assert v is not None and v.suspected is True and v.severity == "severe"
    assert validate_verdict(v, _a(low_energy=0.05)).ok
    assert RE.thin_low_end(_a(low_energy=0.2)) is None


def test_mud_buildup_fires_and_silent():
    a = _a(bands=_bands(low_mid=-10.0, mid=-20.0))  # diff 10 dB
    v = RE.mud_buildup(a)
    assert v is not None and v.severity == "severe" and v.suspected is True
    assert validate_verdict(v, a).ok
    assert RE.mud_buildup(_a(bands=_bands(low_mid=-21.0, mid=-20.0))) is None


def test_harsh_upper_mid_fires_and_silent():
    a = _a(spectral_centroid_hz=6000.0)  # > modern_trance ceiling (~5200)
    v = RE.harsh_upper_mid(a)
    assert v is not None and v.suspected is True
    assert validate_verdict(v, a).ok
    assert RE.harsh_upper_mid(_a(spectral_centroid_hz=3000.0, bands=_bands(upper_mid=-50.0))) is None


def test_dull_no_air_fires_and_silent():
    a = _a(bands=_bands(air=-80.0))  # < modern_trance air floor (~-70)
    v = RE.dull_no_air(a)
    assert v is not None and v.suspected is True
    assert validate_verdict(v, a).ok
    assert RE.dull_no_air(_a(bands=_bands(air=-60.0))) is None


def test_no_tonal_center_fires_and_silent():
    v = RE.no_tonal_center(_a(spectral_flatness=0.6, key_detection_confidence=0.3))
    assert v is not None and v.suspected is True
    assert RE.no_tonal_center(_a(spectral_flatness=0.2, key_detection_confidence=0.9)) is None


def test_over_widened_fires_and_silent():
    a = _a(stereo_width=0.6)  # > modern_trance 'widest' ceiling 0.45
    v = RE.over_widened(a)
    assert v is not None and v.suspected is True
    assert validate_verdict(v, a).ok
    assert RE.over_widened(_a(stereo_width=0.3)) is None
