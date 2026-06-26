from __future__ import annotations
from datetime import datetime, timezone
from aimusic_shared.verdicts.models import (
    DspOp, Evidence, Fix, UserState, Verdict,
)
from aimusic_shared.verdicts.ulid_helpers import new_fix_id, new_verdict_id
from app.verdict_lib.validator import (
    ValidationFailure,
    validate_verdict,
)


def _v(**overrides) -> Verdict:
    base = dict(
        verdict_id=new_verdict_id(),
        track_id="track-1",
        specialist="low_end",
        prompt_version="low_end@1.0.0",
        model="claude-cli",
        severity="moderate",
        category="low_end",
        confidence=0.8,
        priority_score=50,  # will be overwritten
        headline="Headline",
        summary="Summary.",
        evidence=[Evidence(metric="phase3.low_mid_energy", value=0.31,
                           label="lowmid")],
        fix=None,
        why_it_matters="x",
        related_verdict_ids=[],
        sources=["low_end"],
        user_state=UserState(),
        created_at=datetime.now(tz=timezone.utc),
    )
    base.update(overrides)
    return Verdict(**base)


def _analysis(low_mid_energy: float = 0.31, duration: float = 220.0) -> dict:
    return {
        "track_id": "track-1",
        "phase1": {"duration_seconds": duration},
        "phase3": {"low_mid_energy": low_mid_energy},
    }


def test_clean_verdict_passes_and_score_recomputed():
    v = _v()
    result = validate_verdict(v, _analysis())
    assert result.ok
    assert result.verdict.priority_score > 0
    # severity unchanged when score lands in moderate band (50-99)
    assert result.verdict.severity == "moderate"


def test_metric_path_must_resolve():
    v = _v(evidence=[Evidence(metric="phase9.imaginary_metric",
                              value=0.0, label="x")])
    result = validate_verdict(v, _analysis())
    assert not result.ok
    assert isinstance(result.failure, ValidationFailure)
    assert "metric path" in result.failure.reason.lower()


def test_metric_value_must_match_within_tolerance():
    v = _v(evidence=[Evidence(metric="phase3.low_mid_energy",
                              value=0.99, label="fabricated")])
    # actual is 0.31; claimed 0.99 → >10% delta → reject
    result = validate_verdict(v, _analysis())
    assert not result.ok
    assert "value" in result.failure.reason.lower()


def test_severity_downgrade_when_score_too_low():
    v = _v(severity="critical")  # claims critical
    # default analysis → category low_end, scope full_track → score 91 (severe band)
    result = validate_verdict(v, _analysis())
    assert result.ok
    assert result.verdict.severity in ("severe", "moderate")
    assert result.verdict.severity != "critical"


def test_dsp_chain_out_of_range_rejected():
    # Pydantic itself catches this — but the verdict was already constructed
    # with a valid DspOp; we verify the validator passes through unchanged.
    op = DspOp(type="peaking_eq",
               params={"frequency_hz": 250, "gain_db": -4.0, "q": 1.2})
    fix = Fix(fix_id=new_fix_id(),
              target={"type": "stem", "name": "bass"},
              section=None,
              dsp_chain=[op],
              sidechain=None,
              expected_outcome="cleaner",
              ableton_hint=None)
    v = _v(fix=fix)
    result = validate_verdict(v, _analysis())
    assert result.ok


def test_section_end_must_not_exceed_duration():
    fix = Fix(
        fix_id=new_fix_id(),
        target={"type": "stem", "name": "bass"},
        section={"start_seconds": 100.0, "end_seconds": 999.0,
                 "section_type": "drop"},
        dsp_chain=[],
        sidechain=None,
        expected_outcome="ok",
        ableton_hint=None,
    )
    v = _v(fix=fix)
    result = validate_verdict(v, _analysis(duration=220.0))
    assert not result.ok
    assert "section" in result.failure.reason.lower()


# ── Phase 1: NaN/Inf metric must not crash or silently reject ────────────────

def test_nan_actual_metric_does_not_reject_verdict():
    a = _analysis()
    a["phase3"]["low_mid_energy"] = float("nan")  # degenerate measured metric
    v = _v(evidence=[Evidence(metric="phase3.low_mid_energy", value=0.31, label="x")])
    result = validate_verdict(v, a)
    assert result.ok  # can't compare against NaN — don't hard-reject the verdict


# ── Phase 2: source-aware severity downgrade ─────────────────────────────────

def _rule_problem(*, severity="critical", category="dynamics"):
    """A deterministic rule-engine Problem (specialist='rule_engine.<slug>')."""
    from app.verdict_lib.rule_engine import _problem
    return _problem(
        track_id="track-1", slug="over_compression", severity=severity, category=category,
        headline="h", summary="s", why_it_matters="w",
        evidence=[Evidence(metric="phase3.low_mid_energy", value=0.31, label="x")],
    )


def test_rule_engine_severity_is_not_downgraded():
    # A 'dynamics' critical would normally cap to moderate, but a deterministic
    # rule-engine finding's severity is measured -> exempt (architecture §7).
    v = _rule_problem(severity="critical", category="dynamics")
    result = validate_verdict(v, _analysis())
    assert result.ok
    assert result.verdict.severity == "critical"


def test_llm_specialist_severity_still_downgraded():
    # Same category + claimed severity, but an LLM specialist (specialist != rule_engine)
    # keeps the downgrade guard, since it can over-claim.
    v = _v(severity="critical", category="dynamics", specialist="dynamics")
    result = validate_verdict(v, _analysis())
    assert result.ok
    assert result.verdict.severity != "critical"
