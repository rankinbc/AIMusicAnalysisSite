from __future__ import annotations
from typing import Literal
from aimusic_shared.verdicts.models import Severity

Scope = Literal["full_track", "multi_section", "single_section", "single_stem"]


_BASE_SEVERITY: dict[Severity, int] = {
    "critical": 200,
    "severe": 120,
    "moderate": 70,
    "minor": 30,
    "win": 20,
}

_CATEGORY_WEIGHT: dict[str, float] = {
    "clipping": 1.5,
    "loudness": 1.4,
    "mono_compatibility": 1.4,
    "low_end": 1.3,
}

_SCOPE_MULTIPLIER: dict[Scope, float] = {
    "full_track": 1.0,
    "multi_section": 0.9,
    "single_section": 0.7,
    "single_stem": 0.6,
}


def compute_priority_score(
    severity: Severity, category: str, scope: Scope
) -> int:
    if severity not in _BASE_SEVERITY:
        raise ValueError(f"Unknown severity: {severity!r}")
    if scope not in _SCOPE_MULTIPLIER:
        raise ValueError(f"Unknown scope: {scope!r}")
    base = _BASE_SEVERITY[severity]
    cat = _CATEGORY_WEIGHT.get(category, 1.0)
    scp = _SCOPE_MULTIPLIER[scope]
    return round(base * cat * scp)


def severity_from_score(score: int) -> Severity:
    if score >= 200:
        return "critical"
    if score >= 100:
        return "severe"
    if score >= 50:
        return "moderate"
    if score >= 25:
        return "minor"
    return "win"
