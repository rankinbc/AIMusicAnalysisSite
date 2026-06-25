"""Rule-engine tests against the REAL final_json field shape.

Earlier versions of this file fed payloads using field names the rules read but
the pipeline never emits (``integrated_lufs``, ``phase2.stereo_correlation``,
``phase3.low_mid_energy``, ``crest_factor``, ``key_detection_confidence``), so
the suite was green while the rules were dead in production. The pipeline
actually emits ``phase1.lufs`` and ``phase1.stereo_correlation`` (verified via
the pipeline-inspector dev tool against real analyses). These tests use the real
shape; rules still reading non-emitted fields are marked ``xfail(strict=True)``
with their tracking PRP so they cannot pass quietly.
"""
from __future__ import annotations

import pytest

from app.verdict_lib.rule_engine import evaluate_rules
from app.verdict_lib.validator import validate_verdict


def _analysis(**phase1_over) -> dict:
    """A real-shape analysis whose phase1 defaults trip no rule. Override one
    field per test to exercise a single rule."""
    p1 = {
        "lufs": -12.0,
        "true_peak_db": -2.0,
        "mono_compatibility": 0.95,
        "clipping_detected": False,
        "stereo_correlation": 0.6,
        "peak_dbfs": -2.0,
        "rms": 0.15,
        "duration_seconds": 200,
    }
    p1.update(phase1_over)
    return {"track_id": "t", "phase1": p1}


# ── Working rules (read correct fields; unchanged by this PRP) ──────────────


def test_no_rules_fire_on_clean_track(clean_trance):
    assert evaluate_rules(clean_trance) == []


def test_clipping_rule_fires(clipped_pop):
    verdicts = evaluate_rules(clipped_pop)
    clip = next(v for v in verdicts if v.category == "clipping")
    assert clip.severity == "critical"
    assert clip.evidence[0].metric == "phase1.clipped_sample_count"
    assert clip.evidence[0].value == 1842


def test_true_peak_rule_fires(clipped_pop):
    verdicts = evaluate_rules(clipped_pop)
    tp = next(v for v in verdicts
              if v.category == "loudness" and "true peak" in v.headline.lower())
    assert tp.severity == "severe"


def test_mono_incompat_fires(mono_broken_indie):
    verdicts = evaluate_rules(mono_broken_indie)
    mono = next(v for v in verdicts if v.category == "mono_compatibility")
    assert mono.severity == "severe"
    assert mono.evidence[0].metric == "phase1.mono_compatibility"
    assert mono.evidence[0].value == 0.45


# ── Fixed rules: real field shape (phase1.lufs, phase1.stereo_correlation) ──


def test_loudness_too_high_fires_on_real_lufs():
    verdicts = evaluate_rules(_analysis(lufs=-7.0))
    loud = next(v for v in verdicts if "too loud" in v.headline.lower())
    assert loud.severity == "moderate"
    assert loud.evidence[0].metric == "phase1.lufs"
    assert loud.evidence[0].value == -7.0


def test_loudness_too_high_silent_when_in_range():
    verdicts = evaluate_rules(_analysis(lufs=-12.0))
    assert not any("too loud" in v.headline.lower() for v in verdicts)


def test_loudness_too_low_fires_on_real_lufs():
    verdicts = evaluate_rules(_analysis(lufs=-22.0))
    quiet = next(v for v in verdicts if "too quiet" in v.headline.lower())
    assert quiet.severity == "moderate"
    assert quiet.evidence[0].metric == "phase1.lufs"


def test_loudness_too_low_silent_when_in_range():
    verdicts = evaluate_rules(_analysis(lufs=-12.0))
    assert not any("too quiet" in v.headline.lower() for v in verdicts)


def test_stereo_correlation_negative_fires_on_phase1():
    verdicts = evaluate_rules(_analysis(stereo_correlation=-0.25))
    sc = next(v for v in verdicts if v.category == "stereo_phase")
    assert sc.severity == "severe"
    assert sc.evidence[0].metric == "phase1.stereo_correlation"
    assert sc.evidence[0].value == -0.25


def test_stereo_correlation_silent_when_positive():
    verdicts = evaluate_rules(_analysis(stereo_correlation=0.6))
    assert not any(v.category == "stereo_phase" for v in verdicts)


def test_fixed_rule_verdicts_pass_validator():
    # The Evidence.metric must resolve in the analysis or validate_verdict
    # rejects the verdict — this is why the metric string was renamed alongside
    # the read path. Both fixed rules must survive validation against real shape.
    a_loud = _analysis(lufs=-7.0)
    loud = next(v for v in evaluate_rules(a_loud) if "too loud" in v.headline.lower())
    assert validate_verdict(loud, a_loud).ok

    a_stereo = _analysis(stereo_correlation=-0.25)
    sc = next(v for v in evaluate_rules(a_stereo) if v.category == "stereo_phase")
    assert validate_verdict(sc, a_stereo).ok


# ── Deferred dead rules: read datapoints the pipeline never emits. Given a
#    REAL-shape analysis they cannot fire. xfail(strict=True) documents the gap
#    and turns red (XPASS) the moment a rule is fixed, forcing the marker's
#    removal. Tracked in PRPs/rule-engine-tier1-field-fixes.md (Out of Scope).


@pytest.mark.xfail(strict=True, reason="excessive_dynamic_range reads "
                   "phase1.crest_factor — never emitted; PRP Tier-2")
def test_excessive_dynamic_range():
    # peak_dbfs/rms imply a very wide crest, but the rule reads phase1.crest_factor.
    verdicts = evaluate_rules(_analysis(peak_dbfs=-1.0, rms=0.004))
    assert any(v.category == "dynamics" and v.severity == "minor" for v in verdicts)


@pytest.mark.xfail(strict=True, reason="tiny_dynamic_range reads "
                   "phase1.crest_factor — never emitted; PRP Tier-2")
def test_tiny_dynamic_range():
    verdicts = evaluate_rules(_analysis(peak_dbfs=-0.1, rms=0.45))
    assert any(v.category == "dynamics" and v.severity == "severe" for v in verdicts)


@pytest.mark.xfail(strict=True, reason="low_mid_mud_generic reads "
                   "phase3.low_mid_energy (absent) + genre_hint (not an output); PRP Tier-3")
def test_low_mid_mud_generic():
    a = _analysis()
    a["phase1"]["bands"] = {"low_mid": -14.0}  # real low-mid lives here, in dB
    a["phase2"] = {"genre": "house"}
    verdicts = evaluate_rules(a)
    assert any(v.category == "low_end" for v in verdicts)


@pytest.mark.xfail(strict=True, reason="low_mid_mud_trance reads "
                   "phase3.low_mid_energy (absent) + genre_hint (not an output); PRP Tier-3")
def test_low_mid_mud_trance():
    a = _analysis()
    a["phase1"]["bands"] = {"low_mid": -14.0}
    a["phase2"] = {"genre": "trance"}
    verdicts = evaluate_rules(a)
    assert any(v.category == "low_end" and "trance" in v.summary.lower() for v in verdicts)


@pytest.mark.xfail(strict=True, reason="key_detection_low_confidence reads "
                   "phase1.key_detection_confidence — never emitted; PRP Tier-3")
def test_key_detection_low_confidence():
    a = _analysis(detected_key="C#")  # detected_key IS emitted; a confidence is not
    verdicts = evaluate_rules(a)
    assert any(v.category == "harmonic" for v in verdicts)
