"""Tier-A rules — fire from exposed phase-1/phase-9 fields. Genre-aware ones
(A1/A2/A3) read genre_config; defaults resolve to modern_trance.
"""
from __future__ import annotations

from app.verdict_lib import rule_engine as RE
from app.verdict_lib.validator import validate_verdict


def _a(**p1) -> dict:
    base = {
        "lufs": -14.0, "true_peak_db": -2.0, "mono_compatibility": 0.95,
        "clipping_detected": False, "stereo_correlation": 0.6, "crest_factor": 11.0,
        "loudness_range_lu": 8.0, "duration_seconds": 200, "low_energy": 0.2,
    }
    base.update(p1)
    return {"track_id": "t", "phase1": base}


# ── A1 true_peak_overshoot (genre ceiling + hot-master) ──────────────────────

def test_true_peak_overshoot_graduated():
    assert RE.true_peak_overshoot(_a(true_peak_db=0.5)).severity == "severe"
    assert RE.true_peak_overshoot(_a(true_peak_db=-0.1)).severity == "moderate"
    assert RE.true_peak_overshoot(_a(true_peak_db=-2.0)) is None


def test_true_peak_overshoot_resolves():
    a = _a(true_peak_db=0.5)
    assert validate_verdict(RE.true_peak_overshoot(a), a).ok


# ── A4 clipping_count ────────────────────────────────────────────────────────

def test_clipping_count_graduated_and_silent():
    assert RE.clipping_count(_a(clipping_detected=True, clipped_sample_count=5000)).severity == "severe"
    assert RE.clipping_count(_a(clipping_detected=True, clipped_sample_count=50)).severity == "minor"
    assert RE.clipping_count(_a(clipping_detected=False)) is None


# ── A2 loudness_vs_target (genre target) ─────────────────────────────────────

def test_loudness_vs_target_both_directions():
    assert RE.loudness_vs_target(_a(lufs=-7.0)).severity == "severe"
    assert RE.loudness_vs_target(_a(lufs=-22.0)).severity in ("moderate", "severe")
    assert RE.loudness_vs_target(_a(lufs=-14.0)) is None  # on target


# ── A3 over_compression (genre dynamics + techno caveat) ─────────────────────

def test_over_compression_suspected():
    r = RE.over_compression(_a(loudness_range_lu=1.5, crest_factor=3.0))
    assert r.severity == "severe" and r.suspected is True


def test_over_compression_techno_low_lra_not_flagged_alone():
    a = _a(loudness_range_lu=3.0, crest_factor=6.0)
    a["phase2"] = {"genre": "techno"}
    assert RE.over_compression(a) is None


# ── A5 sub_mono_compatibility ────────────────────────────────────────────────

def test_sub_mono_compatibility_graduated():
    assert RE.sub_mono_compatibility(_a(mono_compatibility=0.3)).severity == "severe"
    assert RE.sub_mono_compatibility(_a(mono_compatibility=0.5)).severity == "moderate"
    assert RE.sub_mono_compatibility(_a(mono_compatibility=0.95)) is None


# ── A6 negative_correlation ──────────────────────────────────────────────────

def test_negative_correlation_graduated():
    assert RE.negative_correlation(_a(stereo_correlation=-0.4)).severity == "severe"
    assert RE.negative_correlation(_a(stereo_correlation=-0.1)).severity == "moderate"
    assert RE.negative_correlation(_a(stereo_correlation=0.6)) is None


# ── A13 width_instability (phase9) ───────────────────────────────────────────

def test_width_instability_graduated():
    def a(wc):
        return {"track_id": "t", "phase1": {}, "phase9": {"spatial": {"width_consistency": wc}}}
    assert RE.width_instability(a(30)).severity == "moderate"
    assert RE.width_instability(a(50)).severity == "minor"
    assert RE.width_instability(a(70)) is None
