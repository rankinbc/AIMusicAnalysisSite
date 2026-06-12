from __future__ import annotations
from typing import Iterable

from aimusic_shared.verdicts.models import Severity, Verdict


_SEVERITY_RANK: dict[Severity, int] = {
    "critical": 5, "severe": 4, "moderate": 3, "minor": 2, "win": 1
}


def rank_verdicts(verdicts: Iterable[Verdict]) -> list[Verdict]:
    """Sort by priority_score desc, severity desc, confidence desc, verdict_id asc."""
    return sorted(
        verdicts,
        key=lambda v: (
            -v.priority_score,
            -_SEVERITY_RANK[v.severity],
            -v.confidence,
            v.verdict_id,
        ),
    )
