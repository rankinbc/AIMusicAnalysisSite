from __future__ import annotations
from app.verdict_pipeline.rule_engine import evaluate_rules


def test_no_rules_fire_on_clean_track(clean_trance):
    verdicts = evaluate_rules(clean_trance)
    assert all(v.specialist == "rule_engine" for v in verdicts)
    # clean_trance is engineered to trigger zero rules
    assert verdicts == []


def test_clipping_rule_fires(clipped_pop):
    verdicts = evaluate_rules(clipped_pop)
    cats = [v.category for v in verdicts]
    assert "clipping" in cats
    clip = next(v for v in verdicts if v.category == "clipping")
    assert clip.severity == "critical"
    assert clip.evidence[0].metric == "phase1.clipped_sample_count"
    assert clip.evidence[0].value == 1842


def test_true_peak_rule_fires(clipped_pop):
    verdicts = evaluate_rules(clipped_pop)
    tp = next((v for v in verdicts if v.category == "loudness"
               and "true peak" in v.headline.lower()), None)
    assert tp is not None
    assert tp.severity == "severe"


def test_mono_incompat_fires(mono_broken_indie):
    verdicts = evaluate_rules(mono_broken_indie)
    mono = next(v for v in verdicts if v.category == "mono_compatibility")
    assert mono.severity == "severe"
    assert mono.evidence[0].metric == "phase1.mono_compatibility"
    assert mono.evidence[0].value == 0.45


def test_loudness_too_high_streaming(clipped_pop):
    # clipped_pop has integrated_lufs = -7.0 (> -8) — should fire
    verdicts = evaluate_rules(clipped_pop)
    loud = next((v for v in verdicts if v.category == "loudness"
                 and "too loud" in v.headline.lower()), None)
    assert loud is not None
    assert loud.severity == "moderate"


def test_loudness_too_low_streaming():
    analysis = {
        "track_id": "low-loudness",
        "phase1": {"integrated_lufs": -22.0, "true_peak_db": -3.0,
                   "mono_compatibility": 0.9, "clipping_detected": False,
                   "crest_factor": 8.0, "duration_seconds": 200},
        "phase2": {"stereo_correlation": 0.5},
        "phase3": {"low_mid_energy": 0.15},
        "genre_hint": "ambient",
    }
    verdicts = evaluate_rules(analysis)
    quiet = next(v for v in verdicts if "too quiet" in v.headline.lower())
    assert quiet.severity == "moderate"


def test_low_mid_mud_trance():
    analysis = {
        "track_id": "muddy-trance",
        "phase1": {"integrated_lufs": -10, "true_peak_db": -2,
                   "mono_compatibility": 0.9, "clipping_detected": False,
                   "crest_factor": 9.0, "duration_seconds": 300},
        "phase2": {"stereo_correlation": 0.55},
        "phase3": {"low_mid_energy": 0.22},
        "genre_hint": "trance",
    }
    verdicts = evaluate_rules(analysis)
    mud = next(v for v in verdicts if v.category == "low_end")
    assert mud.severity == "moderate"
    assert "trance" in mud.summary.lower()


def test_low_mid_mud_generic_threshold(muddy_hiphop):
    # muddy_hiphop has low_mid_energy=0.31 (>0.25 generic threshold)
    verdicts = evaluate_rules(muddy_hiphop)
    mud = next(v for v in verdicts if v.category == "low_end")
    assert mud.severity == "moderate"


def test_excessive_dynamic_range():
    analysis = {
        "track_id": "wide-dr",
        "phase1": {"integrated_lufs": -16, "true_peak_db": -2,
                   "mono_compatibility": 0.9, "clipping_detected": False,
                   "crest_factor": 25.0, "duration_seconds": 240},
        "phase2": {"stereo_correlation": 0.5},
        "phase3": {"low_mid_energy": 0.15},
        "genre_hint": "classical",
    }
    verdicts = evaluate_rules(analysis)
    dr = next(v for v in verdicts if v.category == "dynamics")
    assert dr.severity == "minor"


def test_tiny_dynamic_range_fires(tiny_dynamics_edm):
    # tiny_dynamics_edm has crest_factor=3.2
    verdicts = evaluate_rules(tiny_dynamics_edm)
    dr = next(v for v in verdicts if v.category == "dynamics")
    assert dr.severity == "severe"


def test_stereo_correlation_negative(mono_broken_indie):
    verdicts = evaluate_rules(mono_broken_indie)
    sc = next(v for v in verdicts if v.category == "stereo_phase")
    assert sc.severity == "severe"
    assert sc.evidence[0].value == -0.25


def test_key_detection_low_confidence():
    analysis = {
        "track_id": "uncertain-key",
        "phase1": {"integrated_lufs": -12, "true_peak_db": -2,
                   "mono_compatibility": 0.9, "clipping_detected": False,
                   "crest_factor": 10.0, "duration_seconds": 200,
                   "key_detection_confidence": 0.3},
        "phase2": {"stereo_correlation": 0.5},
        "phase3": {"low_mid_energy": 0.15},
        "genre_hint": "rock",
    }
    verdicts = evaluate_rules(analysis)
    key = next(v for v in verdicts if v.category == "harmonic")
    assert key.severity == "minor"
