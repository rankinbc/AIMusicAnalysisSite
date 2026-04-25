from __future__ import annotations
from datetime import datetime, timezone
from aimusic_shared.verdicts.models import Evidence, UserState, Verdict
from aimusic_shared.verdicts.ulid_helpers import new_verdict_id
from app.verdict_pipeline.dedupe import dedupe_verdicts


def _v(specialist="low_end", category="low_end", metric="phase3.low_mid_energy",
       severity="moderate", confidence=0.8, sources=None, headline="x",
       summary="s") -> Verdict:
    return Verdict(
        verdict_id=new_verdict_id(),
        track_id="t1",
        specialist=specialist,
        prompt_version=f"{specialist}@1.0.0",
        model="claude-cli",
        severity=severity,  # type: ignore[arg-type]
        category=category,  # type: ignore[arg-type]
        confidence=confidence,
        priority_score=50,
        headline=headline,
        summary=summary,
        evidence=[Evidence(metric=metric, value=0.31, label="x")],
        fix=None,
        why_it_matters="x",
        related_verdict_ids=[],
        sources=sources or [specialist],
        user_state=UserState(),
        created_at=datetime.now(tz=timezone.utc),
    )


def test_no_overlap_no_merge():
    a = _v(category="low_end", metric="phase3.low_mid_energy")
    b = _v(category="loudness", metric="phase1.integrated_lufs",
           specialist="loudness")
    out = dedupe_verdicts([a, b])
    assert len(out) == 2


def test_same_category_and_metric_merges():
    rule = _v(specialist="rule_engine", sources=["rule_engine"],
              headline="Rule headline", confidence=1.0)
    spec = _v(specialist="low_end", sources=["low_end"],
              headline="Specialist longer richer headline", confidence=0.85,
              summary="Specialist summary that is longer than the rule one.")
    out = dedupe_verdicts([rule, spec])
    assert len(out) == 1
    merged = out[0]
    assert set(merged.sources) == {"rule_engine", "low_end"}
    # specialist headline is longer → wins
    assert "Specialist" in merged.headline


def test_higher_severity_wins():
    a = _v(severity="moderate")
    b = _v(severity="severe", specialist="rule_engine", sources=["rule_engine"])
    out = dedupe_verdicts([a, b])
    assert len(out) == 1
    assert out[0].severity == "severe"


def test_evidence_unioned_and_dedup_by_path():
    a = _v(metric="phase3.low_mid_energy")
    a = a.model_copy(update={"evidence": list(a.evidence) + [
        Evidence(metric="stem.kick_bass_clash", value=0.6, label="extra")
    ]})
    b = _v(metric="phase3.low_mid_energy", specialist="rule_engine",
           sources=["rule_engine"])
    out = dedupe_verdicts([a, b])
    assert len(out) == 1
    paths = {e.metric for e in out[0].evidence}
    assert paths == {"phase3.low_mid_energy", "stem.kick_bass_clash"}


def test_three_way_merge():
    a = _v(specialist="rule_engine", sources=["rule_engine"])
    b = _v(specialist="low_end", sources=["low_end"])
    c = _v(specialist="frequency_balance", sources=["frequency_balance"])
    out = dedupe_verdicts([a, b, c])
    assert len(out) == 1
    assert set(out[0].sources) == {"rule_engine", "low_end", "frequency_balance"}
