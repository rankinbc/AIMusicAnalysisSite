from __future__ import annotations
from datetime import datetime, timezone
from aimusic_shared.verdicts.models import Evidence, UserState, Verdict
from aimusic_shared.verdicts.ulid_helpers import new_verdict_id
from app.verdict_pipeline.ranker import rank_verdicts


def _v(severity="moderate", priority_score=50, confidence=0.5,
       verdict_id=None) -> Verdict:
    return Verdict(
        verdict_id=verdict_id or new_verdict_id(),
        track_id="t1",
        specialist="x",
        prompt_version="x@1.0.0",
        model="claude-cli",
        severity=severity,  # type: ignore[arg-type]
        category="loudness",
        confidence=confidence,
        priority_score=priority_score,
        headline="h",
        summary="s",
        evidence=[Evidence(metric="phase1.x", label="x")],
        fix=None,
        why_it_matters="x",
        related_verdict_ids=[],
        sources=["x"],
        user_state=UserState(),
        created_at=datetime.now(tz=timezone.utc),
    )


def test_sort_by_priority_score_desc():
    a = _v(priority_score=100)
    b = _v(priority_score=200)
    c = _v(priority_score=50)
    out = rank_verdicts([a, b, c])
    assert [v.priority_score for v in out] == [200, 100, 50]


def test_severity_breaks_score_tie():
    a = _v(severity="moderate", priority_score=100)
    b = _v(severity="critical", priority_score=100)
    out = rank_verdicts([a, b])
    assert out[0].severity == "critical"


def test_confidence_breaks_severity_tie():
    a = _v(severity="severe", priority_score=120, confidence=0.6)
    b = _v(severity="severe", priority_score=120, confidence=0.9)
    out = rank_verdicts([a, b])
    assert out[0].confidence == 0.9


def test_verdict_id_breaks_all_ties():
    a = _v(verdict_id="vrd_aaa", priority_score=50, confidence=0.5)
    b = _v(verdict_id="vrd_bbb", priority_score=50, confidence=0.5)
    out = rank_verdicts([b, a])
    assert out[0].verdict_id == "vrd_aaa"
