from __future__ import annotations
import math
from dataclasses import dataclass
from typing import Any

from aimusic_shared.verdicts.models import Severity, Verdict
from aimusic_shared.verdicts.scoring import (
    compute_priority_score,
    severity_from_score,
)


@dataclass
class ValidationFailure:
    specialist: str
    prompt_version: str
    reason: str
    raw_excerpt: str = ""


@dataclass
class ValidationResult:
    ok: bool
    verdict: Verdict | None = None
    failure: ValidationFailure | None = None


import re as _re

def _resolve_path(obj: Any, path: str) -> Any:
    """Resolve a dotted path against a dict/list tree.
    Supports array-index notation: phases[0].data.rms
    Raises KeyError if any segment is missing."""
    cur = obj
    # Split on dots, but keep bracket tokens attached to the preceding key
    # e.g. "phases[0].data.rms" → ["phases[0]", "data", "rms"]
    for seg in path.split("."):
        m = _re.fullmatch(r'(\w+)\[(\d+)\]', seg)
        if m:
            key, idx = m.group(1), int(m.group(2))
            if not isinstance(cur, dict) or key not in cur:
                raise KeyError(key)
            lst = cur[key]
            if not isinstance(lst, list) or idx >= len(lst):
                raise KeyError(f"{key}[{idx}]")
            cur = lst[idx]
        else:
            if not isinstance(cur, dict):
                raise KeyError(f"path segment {seg!r}: parent is not a dict")
            if seg not in cur:
                raise KeyError(seg)
            cur = cur[seg]
    return cur


def _value_close(a: Any, b: Any, *, rel_tol: float = 0.10) -> bool:
    """Compare numeric values with 10% relative tolerance.
    Non-numeric: must be equal."""
    try:
        af, bf = float(a), float(b)
    except (TypeError, ValueError):
        return a == b
    if af == 0.0 and bf == 0.0:
        return True
    return math.isclose(af, bf, rel_tol=rel_tol)


def _infer_scope(verdict: Verdict) -> str:
    """Heuristic — single_section if fix has a section; single_stem if target is a stem;
    else full_track."""
    if verdict.fix is None:
        return "full_track"
    if verdict.fix.section is not None:
        return "single_section"
    target = verdict.fix.target or {}
    if target.get("type") == "stem":
        return "single_stem"
    return "full_track"


def validate_verdict(verdict: Verdict, analysis: dict[str, Any]) -> ValidationResult:
    """Run every check in order. Recompute priority_score and adjust severity.
    Returns ValidationResult with ok=False + failure on rejection."""
    fail = lambda reason: ValidationResult(  # noqa: E731
        ok=False,
        failure=ValidationFailure(
            specialist=verdict.specialist,
            prompt_version=verdict.prompt_version,
            reason=reason,
            raw_excerpt=verdict.headline[:200],
        ),
    )

    # 1. Metric path resolution + value check
    for ev in verdict.evidence:
        try:
            actual = _resolve_path(analysis, ev.metric)
        except KeyError:
            return fail(f"metric path {ev.metric!r} does not resolve in analysis JSON")
        if ev.value is not None and not _value_close(actual, ev.value):
            return fail(
                f"metric {ev.metric!r}: claimed value {ev.value!r} differs from "
                f"actual {actual!r} by more than 10%"
            )

    # 2. Section sanity
    if verdict.fix is not None and verdict.fix.section is not None:
        sec = verdict.fix.section
        start = sec.get("start_seconds")
        end = sec.get("end_seconds")
        duration = (analysis.get("phase1") or {}).get("duration_seconds")
        if start is None or end is None:
            return fail("fix.section requires start_seconds and end_seconds")
        if start >= end:
            return fail(f"fix.section: start {start} >= end {end}")
        if duration is not None and end > duration + 0.5:
            return fail(
                f"fix.section.end_seconds {end} exceeds track duration {duration}"
            )

    # 3. Severity-justification check using a moderate-severity baseline.
    #    If we naively recomputed the score under the claimed severity, category
    #    weights (e.g. low_end=1.3) would let a critical claim self-justify into
    #    a critical-band score. Instead, compute what a moderate baseline yields
    #    for this (category, scope), and require the claimed severity to be no
    #    higher than that band.
    scope = _infer_scope(verdict)
    baseline_score = compute_priority_score("moderate", verdict.category, scope)  # type: ignore[arg-type]
    baseline_band = severity_from_score(baseline_score)
    severity_rank: dict[Severity, int] = {
        "critical": 5, "severe": 4, "moderate": 3, "minor": 2, "win": 1
    }
    if severity_rank[verdict.severity] > severity_rank[baseline_band]:
        new_severity: Severity = baseline_band
        score = compute_priority_score(new_severity, verdict.category, scope)  # type: ignore[arg-type]
        return ValidationResult(
            ok=True,
            verdict=verdict.model_copy(update={
                "severity": new_severity,
                "priority_score": score,
            }),
        )

    score = compute_priority_score(verdict.severity, verdict.category, scope)  # type: ignore[arg-type]
    return ValidationResult(
        ok=True,
        verdict=verdict.model_copy(update={"priority_score": score}),
    )
