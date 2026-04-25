from __future__ import annotations
import pytest
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
