"""Tier-C composites C1/C2/C3/C5/C6 — corroborated, genre-aware records that
absorb their child singles. Each: fires + suppresses children, stays silent when
inputs are incomplete, and every emitted record's evidence resolves (validator).

C4 (untreated_low_end) lives in test_rules_tier_b.py (needs the B1 lift);
C7 (no_drop_payoff) is deferred (needs the section-RMS lift).
"""
from __future__ import annotations

from app.verdict_lib import rule_engine as RE
from app.verdict_lib.validator import validate_verdict


def _slugs(out):
    return {v.problem_id.split(".")[1] for v in out}


# ── C1 loudness_war (genre-aware; suppresses over_compression + true_peak) ────

def test_loudness_war_fires_and_suppresses_children():
    # default genre → modern_trance: crest_warn 4.5, lra_floor fallback 4.0.
    a = {"track_id": "t", "phase1": {
        "crest_factor": 3.0, "loudness_range_lu": 2.9, "true_peak_db": -0.1,
        "lufs": -8.0, "clipping_detected": False}}
    out = RE.evaluate_problems(
        a,
        singles=[("over_compression", RE.over_compression),
                 ("true_peak_overshoot", RE.true_peak_overshoot)],
        composites=[("loudness_war", ["over_compression", "true_peak_overshoot"],
                     RE.loudness_war)],
    )
    s = _slugs(out)
    assert "loudness_war" in s
    assert "over_compression" not in s and "true_peak_overshoot" not in s
    war = next(v for v in out if v.problem_id.endswith("loudness_war.0"))
    assert war.suspected is False and war.confidence == 0.95 and war.severity == "severe"
    assert war.related_verdict_ids  # audit trail of absorbed children
    assert validate_verdict(war, a).ok


def test_loudness_war_silent_for_techno_dense_master():
    # techno crest 5 / LRA 3 is normal — genre warn_below(4) gates it out.
    a = {"track_id": "t", "phase2": {"genre": "techno"},
         "phase1": {"crest_factor": 5.0, "loudness_range_lu": 3.2, "true_peak_db": -0.1}}
    assert RE.loudness_war(a, {}) is None


def test_loudness_war_silent_when_only_one_input():
    a = {"track_id": "t", "phase1": {"crest_factor": 4.8, "loudness_range_lu": 8.0,
                                     "true_peak_db": -2.0}}
    assert RE.loudness_war(a, {}) is None


# ── C2 congested_mix (mud_buildup + low contrast + elevated flatness) ─────────

def _congested():
    return {"track_id": "t", "phase1": {
        "bands": {"sub_bass": -20.0, "bass": -18.0, "low_mid": -10.0, "mid": -20.0,
                  "upper_mid": -45.0, "presence": -55.0, "air": -65.0},
        "spectral_contrast": 10.0, "spectral_flatness": 0.4}}


def test_congested_mix_fires_and_suppresses_mud():
    a = _congested()
    out = RE.evaluate_problems(
        a,
        singles=[("mud_buildup", RE.mud_buildup)],
        composites=[("congested_mix", ["mud_buildup"], RE.congested_mix)],
    )
    s = _slugs(out)
    assert "congested_mix" in s and "mud_buildup" not in s
    comp = next(v for v in out if v.problem_id.endswith("congested_mix.0"))
    assert comp.category == "clarity" and comp.suspected is False
    assert validate_verdict(comp, a).ok


def test_congested_mix_silent_without_mud():
    a = _congested()
    assert RE.congested_mix(a, {}) is None  # mud_buildup not fired


def test_congested_mix_silent_when_contrast_healthy():
    a = _congested()
    a["phase1"]["spectral_contrast"] = 30.0
    mud = RE.mud_buildup(a)
    assert RE.congested_mix(a, {"mud_buildup": mud}) is None


# ── C3 phantom_width (over_widened + poor mono + negative correlation) ────────

def _phantom():
    return {"track_id": "t", "phase1": {
        "stereo_width": 0.6, "mono_compatibility": 0.4, "stereo_correlation": 0.05}}


def test_phantom_width_fires_and_suppresses_children():
    a = _phantom()
    out = RE.evaluate_problems(
        a,
        singles=[("over_widened", RE.over_widened),
                 ("sub_mono_compatibility", RE.sub_mono_compatibility),
                 ("negative_correlation", RE.negative_correlation)],
        composites=[("phantom_width",
                     ["over_widened", "sub_mono_compatibility", "negative_correlation"],
                     RE.phantom_width)],
    )
    s = _slugs(out)
    assert "phantom_width" in s and "over_widened" not in s
    comp = next(v for v in out if v.problem_id.endswith("phantom_width.0"))
    assert comp.category == "stereo_field" and comp.confidence == 0.92
    assert validate_verdict(comp, a).ok


def test_phantom_width_silent_when_mono_safe():
    a = _phantom()
    a["phase1"]["mono_compatibility"] = 0.9
    ow = RE.over_widened(a)
    assert RE.phantom_width(a, {"over_widened": ow}) is None


# ── C5 lifeless_at_source (crushed crest + robotic MIDI on ≥2 tracks) ─────────

def _lifeless():
    return {"track_id": "t",
            "phase1": {"crest_factor": 3.0},
            "phase8": {"per_track_analysis": {
                "Lead": {"humanization_score": "robotic", "velocity_std": 0.0},
                "Bass": {"humanization_score": "robotic", "velocity_std": 0.0}}}}


def test_lifeless_at_source_fires():
    a = _lifeless()
    v = RE.lifeless_at_source(a, {})
    assert v is not None and v.category == "humanization" and v.confidence == 0.93
    assert v.suspected is False
    # FR12: attribute to the robotic named tracks (up to 3).
    assert v.where == {"track_names": ["Lead", "Bass"]}
    assert validate_verdict(v, a).ok


def test_lifeless_at_source_silent_without_phase8():
    a = {"track_id": "t", "phase1": {"crest_factor": 3.0}}
    assert RE.lifeless_at_source(a, {}) is None


def test_lifeless_at_source_silent_with_one_robotic_track():
    a = _lifeless()
    a["phase8"]["per_track_analysis"].pop("Bass")
    assert RE.lifeless_at_source(a, {}) is None


# ── C6 thin_and_bright (thin_low_end + bright centroid + hot air) ─────────────

def _thinbright():
    return {"track_id": "t", "phase1": {
        "low_energy": 0.05, "spectral_centroid_hz": 6000.0,
        "bands": {"sub_bass": -20.0, "bass": -18.0, "low_mid": -22.0, "mid": -20.0,
                  "upper_mid": -45.0, "presence": -55.0, "air": -40.0}}}


def test_thin_and_bright_fires_and_suppresses_children():
    a = _thinbright()
    out = RE.evaluate_problems(
        a,
        singles=[("thin_low_end", RE.thin_low_end),
                 ("harsh_upper_mid", RE.harsh_upper_mid),
                 ("dull_no_air", RE.dull_no_air)],
        composites=[("thin_and_bright",
                     ["thin_low_end", "harsh_upper_mid", "dull_no_air"],
                     RE.thin_and_bright)],
    )
    s = _slugs(out)
    assert "thin_and_bright" in s and "thin_low_end" not in s
    comp = next(v for v in out if v.problem_id.endswith("thin_and_bright.0"))
    assert comp.category == "frequency_balance" and comp.confidence == 0.88
    assert validate_verdict(comp, a).ok


def test_thin_and_bright_silent_without_thin_low_end():
    a = _thinbright()
    assert RE.thin_and_bright(a, {}) is None


# ── global registration: all five are wired into the module registry ─────────

def test_all_five_composites_registered():
    registered = {slug for slug, _suppresses, _fn in RE._COMPOSITES}
    assert {"loudness_war", "congested_mix", "phantom_width",
            "lifeless_at_source", "thin_and_bright"} <= registered
