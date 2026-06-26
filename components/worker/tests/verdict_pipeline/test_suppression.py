"""Tier-C suppression algorithm: composites absorb their child singles, with an
audit trail (router.md §1a) so a vanished card is traceable. Higher-severity
composite wins a contested child; every fired composite survives.
"""
from __future__ import annotations

from datetime import datetime, timezone

from aimusic_shared.verdicts.models import Evidence, Verdict

from app.verdict_lib.suppression import SEVERITY_RANK, apply


def _rec(slug: str, category: str, severity: str) -> Verdict:
    return Verdict(
        verdict_id="vrd_" + slug, track_id="t", specialist="rule_engine." + slug,
        prompt_version="rule_engine@2.0.0", model="rules", severity=severity,
        category=category, confidence=0.9, priority_score=50, headline=slug, summary="s",
        evidence=[Evidence(metric="phase1.lufs", value=-1.0, label="x")],
        why_it_matters="w", sources=["rule_engine"], created_at=datetime.now(timezone.utc),
        problem_id=f"{category}.{slug}.0",
    )


def _slugs(records):
    return {v.problem_id.split(".")[1] for v in records}


def test_severity_rank_orders_correctly():
    assert SEVERITY_RANK["critical"] > SEVERITY_RANK["severe"] > SEVERITY_RANK["moderate"]


def test_composite_absorbs_its_children_with_audit_trail():
    singles = {
        "over_compression": _rec("over_compression", "dynamics", "moderate"),
        "true_peak_overshoot": _rec("true_peak_overshoot", "clipping", "moderate"),
    }
    comp = _rec("loudness_war", "dynamics", "severe")
    out = apply(singles, [("loudness_war", ["over_compression", "true_peak_overshoot"], comp)])
    s = _slugs(out)
    assert "loudness_war" in s
    assert "over_compression" not in s and "true_peak_overshoot" not in s
    war = next(v for v in out if v.problem_id.endswith("loudness_war.0"))
    assert set(war.related_verdict_ids) == {
        "dynamics.over_compression.0", "clipping.true_peak_overshoot.0",
    }


def test_contested_child_goes_to_higher_severity_composite():
    singles = {"a": _rec("a", "dynamics", "minor")}
    c_hi = _rec("hi", "dynamics", "severe")
    c_lo = _rec("lo", "dynamics", "moderate")
    out = apply(singles, [("lo", ["a"], c_lo), ("hi", ["a"], c_hi)])
    s = _slugs(out)
    assert "a" not in s              # absorbed once
    assert "hi" in s and "lo" in s   # both composites still fire
    hi = next(v for v in out if v.problem_id.endswith("hi.0"))
    assert hi.related_verdict_ids == ["dynamics.a.0"]


def test_unclaimed_single_survives():
    singles = {"lonely": _rec("lonely", "dynamics", "moderate")}
    out = apply(singles, [])
    assert _slugs(out) == {"lonely"}
