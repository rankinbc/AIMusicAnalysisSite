"""Tier-A structure + tempo rules — genre-driven via genre_config (A15, A16,
bpm_genre_match). Gated on arrangement_status == 'scored' (never grade an
unscored/short track).
"""
from __future__ import annotations

from app.verdict_lib import rule_engine as RE
from app.verdict_lib.validator import validate_verdict


def _a(genre: str = "trance", bpm: float = 138.0, eight_bar: float = 85.0, **flags) -> dict:
    meta = {"has_intro": True, "has_buildup": True, "has_drop": True,
            "has_breakdown": True, "has_outro": True, "section_count": 6}
    meta.update(flags)
    return {
        "track_id": "t",
        "phase1": {"bpm": bpm},
        "phase2": {"genre": genre},
        "phase7": {"arrangement_status": "scored", "eight_bar_score": eight_bar, "metadata": meta},
    }


# ── A15 missing_section ──────────────────────────────────────────────────────

def test_missing_section_fires_severe_for_missing_drop():
    a = _a(has_drop=False)
    v = RE.missing_section(a)
    assert v is not None and v.category == "sections" and v.severity == "severe"
    assert validate_verdict(v, a).ok


def test_missing_section_silent_when_complete():
    assert RE.missing_section(_a()) is None


def test_missing_section_silent_when_not_scored():
    a = _a(has_drop=False)
    a["phase7"]["arrangement_status"] = "pending"
    assert RE.missing_section(a) is None


def test_missing_section_techno_not_flagged_for_no_drop():
    # techno required_sections = [intro, breakdown, outro] — a missing drop is by design.
    a = _a(genre="techno", has_drop=False)
    assert RE.missing_section(a) is None


# ── A16 eight_bar_violations ─────────────────────────────────────────────────

def test_eight_bar_violations_graduated():
    assert RE.eight_bar_violations(_a(eight_bar=40)).severity == "moderate"
    assert RE.eight_bar_violations(_a(eight_bar=60)).severity == "minor"
    assert RE.eight_bar_violations(_a(eight_bar=85)) is None


# ── bpm_genre_match ──────────────────────────────────────────────────────────

def test_bpm_genre_match_fires_outside_range():
    a = _a(bpm=100.0)  # modern_trance 136-142
    v = RE.bpm_genre_match(a)
    assert v is not None and v.suspected is True
    assert validate_verdict(v, a).ok


def test_bpm_genre_match_silent_in_range():
    assert RE.bpm_genre_match(_a(bpm=138.0)) is None
