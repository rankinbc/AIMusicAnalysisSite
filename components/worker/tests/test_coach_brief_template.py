"""Task G3 — the deterministic (non-LLM) opening-brief template. Used when
budget is exhausted, the LLM is unavailable, or LLM_FAKE=1. Pure function:
never invents a number, never leads with a suspected/failed finding, never
empty.
"""
from __future__ import annotations

from app.coach_lib.brief_template import build_template_brief

V = [
    {"specialist": "stereo_phase", "severity": "moderate", "category": "stereo", "headline": "Correlation 0.12: mix is on the edge of collapsing in mono",
     "summary": "Left and right are nearly unrelated. Check the mix in mono.", "metric_line": "L/R correlation 0.12", "priority_score": 91, "suspected": False},
    {"specialist": "loudness", "severity": "moderate", "category": "loudness", "headline": "Integrated loudness -16.9 LUFS",
     "summary": "2.9 dB under the streaming target.", "metric_line": "LUFS -16.9", "priority_score": 80, "suspected": False},
    {"specialist": "low_end", "severity": "minor", "category": "spectrum", "headline": "Low-mid mud", "summary": "Bass and low-mids sit too close.",
     "metric_line": None, "priority_score": 70, "suspected": False},
    {"specialist": "dynamics", "severity": "minor", "category": "dynamics", "headline": "Weak transient attack", "summary": "Soft.",
     "metric_line": None, "priority_score": 60, "suspected": False},
    {"specialist": "rule_engine.x", "severity": "moderate", "category": "spectrum", "headline": "Maybe dull", "summary": "?",
     "metric_line": None, "priority_score": 99, "suspected": True},
    {"specialist": "clarity", "severity": "moderate", "category": "spectrum", "headline": "Specialist failed", "summary": "boom",
     "metric_line": None, "priority_score": 98, "suspected": False},
]


def test_lists_the_three_highest_priorities_in_order():
    text = build_template_brief(V)
    a, b, c = (text.index("Correlation 0.12"), text.index("Integrated loudness"), text.index("Low-mid mud"))
    assert a < b < c
    assert "Weak transient attack" not in text          # only three


def test_never_leads_with_a_suspected_or_failed_finding():
    text = build_template_brief(V)
    assert "Maybe dull" not in text and "Specialist failed" not in text


def test_only_repeats_numbers_that_are_stored():
    import re
    stored = " ".join(f"{v['headline']} {v['summary']} {v['metric_line'] or ''}" for v in V)
    for n in re.findall(r"\d+(?:\.\d+)?", build_template_brief(V)):
        assert n in stored or n in {"1", "2", "3"}       # list markers are the only free digits


def test_an_analysis_with_no_findings_still_says_something_useful():
    text = build_template_brief([])
    assert len(text) > 40 and "error" not in text.lower()
