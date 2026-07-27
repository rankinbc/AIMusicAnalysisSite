from __future__ import annotations
import pytest
from aimusic_shared.verdicts.scoring import (
    compute_priority_breakdown,
    compute_priority_score,
    severity_from_score,
)


def test_critical_full_track_clipping():
    # base=200, category=1.5, scope=1.0  → 300
    assert compute_priority_score("critical", "clipping", "full_track") == 300


def test_severe_full_track_loudness():
    # base=120, category=1.4, scope=1.0  → 168
    assert compute_priority_score("severe", "loudness", "full_track") == 168


def test_moderate_single_section_low_end():
    # base=70, category=1.3, scope=0.7   → 64 (rounded from 63.7)
    assert compute_priority_score("moderate", "low_end", "single_section") == 64


def test_minor_single_stem_dynamics():
    # base=30, category=1.0, scope=0.6   → 18
    assert compute_priority_score("minor", "dynamics", "single_stem") == 18


def test_win_full_track():
    # base=20, category=1.0, scope=1.0   → 20
    assert compute_priority_score("win", "frequency_balance", "full_track") == 20


def test_unknown_category_defaults_to_1_0():
    # base=70, category=1.0, scope=1.0   → 70
    assert compute_priority_score("moderate", "device_chain", "full_track") == 70


def test_severity_from_score_bands():
    assert severity_from_score(250) == "critical"
    assert severity_from_score(200) == "critical"
    assert severity_from_score(199) == "severe"
    assert severity_from_score(120) == "severe"
    assert severity_from_score(99) == "moderate"
    assert severity_from_score(70) == "moderate"
    assert severity_from_score(40) == "minor"
    assert severity_from_score(25) == "minor"
    assert severity_from_score(20) == "win"
    assert severity_from_score(0) == "win"


def test_unknown_severity_raises():
    with pytest.raises(ValueError):
        compute_priority_score("emergency", "clipping", "full_track")  # type: ignore[arg-type]


def test_unknown_scope_raises():
    with pytest.raises(ValueError):
        compute_priority_score("severe", "clipping", "headphones")  # type: ignore[arg-type]


# ── Results v4: breakdown variant (compute_priority_score delegates to it) ──


def test_breakdown_critical_clipping_full_track():
    bd = compute_priority_breakdown("critical", "clipping", "full_track")
    assert bd.base == 200
    assert bd.category_weight == 1.5
    assert bd.scope_multiplier == 1.0
    assert bd.scope == "full_track"
    assert bd.score == 300


def test_breakdown_moderate_low_end_single_section():
    bd = compute_priority_breakdown("moderate", "low_end", "single_section")
    assert (bd.base, bd.category_weight, bd.scope_multiplier) == (70, 1.3, 0.7)
    assert bd.score == 64  # rounded from 63.7


def test_breakdown_unknown_category_weight_is_1():
    bd = compute_priority_breakdown("minor", "device_chain", "single_stem")
    assert bd.category_weight == 1.0
    assert bd.score == 18


def test_score_always_equals_breakdown_product():
    for sev in ("critical", "severe", "moderate", "minor", "win"):
        for cat in ("clipping", "loudness", "low_end", "anything_else"):
            for scope in ("full_track", "multi_section", "single_section", "single_stem"):
                bd = compute_priority_breakdown(sev, cat, scope)  # type: ignore[arg-type]
                assert bd.score == round(bd.base * bd.category_weight * bd.scope_multiplier)
                assert bd.score == compute_priority_score(sev, cat, scope)  # type: ignore[arg-type]


def test_breakdown_unknown_severity_raises():
    with pytest.raises(ValueError):
        compute_priority_breakdown("emergency", "clipping", "full_track")  # type: ignore[arg-type]
