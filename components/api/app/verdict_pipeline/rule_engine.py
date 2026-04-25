from __future__ import annotations
from datetime import datetime, timezone
from typing import Any, Callable

from aimusic_shared.verdicts.models import Evidence, Severity, Verdict
from aimusic_shared.verdicts.scoring import compute_priority_score
from aimusic_shared.verdicts.ulid_helpers import new_verdict_id

RULE_ENGINE_VERSION = "rule_engine@1.0.0"
RULE_MODEL = "rules"

RuleFn = Callable[[dict[str, Any]], "Verdict | None"]
_RULES: list[RuleFn] = []


def rule(fn: RuleFn) -> RuleFn:
    """Decorator to register a rule function."""
    _RULES.append(fn)
    return fn


def evaluate_rules(analysis: dict[str, Any]) -> list[Verdict]:
    """Run every registered rule. Each rule returns a Verdict or None."""
    out: list[Verdict] = []
    for fn in _RULES:
        v = fn(analysis)
        if v is not None:
            out.append(v)
    return out


def _make(
    *,
    track_id: str,
    severity: Severity,
    category: str,
    headline: str,
    summary: str,
    evidence: list[Evidence],
    why_it_matters: str,
    scope: str = "full_track",
    confidence: float = 1.0,
) -> Verdict:
    score = compute_priority_score(severity, category, scope)  # type: ignore[arg-type]
    return Verdict(
        verdict_id=new_verdict_id(),
        track_id=track_id,
        specialist="rule_engine",
        prompt_version=RULE_ENGINE_VERSION,
        model=RULE_MODEL,
        severity=severity,
        category=category,  # type: ignore[arg-type]
        confidence=confidence,
        priority_score=score,
        headline=headline,
        summary=summary,
        evidence=evidence,
        fix=None,
        why_it_matters=why_it_matters,
        related_verdict_ids=[],
        sources=["rule_engine"],
        created_at=datetime.now(tz=timezone.utc),
    )


def _track_id(analysis: dict[str, Any]) -> str:
    return analysis.get("track_id", "unknown-track")


def _phase(analysis: dict[str, Any], key: str) -> dict[str, Any]:
    return analysis.get(key) or {}


# ── Rules ──────────────────────────────────────────────────────────────────


@rule
def clipping_detected(analysis: dict[str, Any]) -> Verdict | None:
    p1 = _phase(analysis, "phase1")
    if not p1.get("clipping_detected"):
        return None
    n = int(p1.get("clipped_sample_count", 0))
    return _make(
        track_id=_track_id(analysis),
        severity="critical",
        category="clipping",
        headline=f"Hard clipping detected ({n} samples)",
        summary="The signal is hitting digital ceiling. Distortion is audible "
                "and unfixable downstream.",
        evidence=[Evidence(
            metric="phase1.clipped_sample_count",
            value=float(n),
            label=f"{n} clipped samples",
        )],
        why_it_matters="Clipping is irreversible distortion. Mastering and "
                       "limiting downstream cannot remove it.",
    )


@rule
def true_peak_over_minus_1(analysis: dict[str, Any]) -> Verdict | None:
    p1 = _phase(analysis, "phase1")
    tp = p1.get("true_peak_db")
    if tp is None or tp <= -1.0:
        return None
    return _make(
        track_id=_track_id(analysis),
        severity="severe",
        category="loudness",
        headline=f"True peak {tp:+.2f} dBTP — exceeds streaming limits",
        summary=f"Peak is {tp:+.2f} dBTP. Streaming services re-encode and "
                "introduce inter-sample peaks; aim for ≤ -1.0 dBTP.",
        evidence=[Evidence(
            metric="phase1.true_peak_db",
            value=float(tp),
            expected_range=(-6.0, -1.0),
            label=f"{tp:+.2f} dBTP",
        )],
        why_it_matters="Codec re-encoding (AAC, Opus) raises peaks. Any track "
                       "above -1.0 dBTP risks audible inter-sample distortion "
                       "on Spotify, YouTube, Apple Music.",
    )


@rule
def mono_incompatible(analysis: dict[str, Any]) -> Verdict | None:
    p1 = _phase(analysis, "phase1")
    mono = p1.get("mono_compatibility")
    if mono is None or mono >= 0.7:
        return None
    return _make(
        track_id=_track_id(analysis),
        severity="severe",
        category="mono_compatibility",
        headline=f"Mono compatibility low ({mono:.2f})",
        summary=f"Mono fold-down RMS ratio is {mono:.2f}. Phase cancellation "
                "in stereo content is collapsing parts of the mix in mono.",
        evidence=[Evidence(
            metric="phase1.mono_compatibility",
            value=float(mono),
            expected_range=(0.7, 1.0),
            label=f"{mono:.2f} ratio",
        )],
        why_it_matters="Club systems, AM radio, single-speaker phones, and "
                       "Bluetooth earbuds can collapse a mix to mono. Parts "
                       "that disappear there sound thin and broken.",
    )
