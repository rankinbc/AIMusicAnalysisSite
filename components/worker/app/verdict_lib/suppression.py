"""Tier-C suppression: composites absorb their child singles.

A composite carries a ``suppresses`` list of child slugs. When it fires, those
children are dropped from the surviving set (consolidation — the producer sees
one certain card, not three vague ones). Two engine rules from rules.md:

  - **Higher-severity wins a contested child.** If two composites both claim a
    child, the hotter one absorbs it; the other still fires (keeping its own
    independent inputs).
  - **Audit trail** (router.md §1a): the absorbing composite records the child's
    ``problem_id`` in its ``related_verdict_ids`` so a vanished card is always
    traceable to the composite that consumed it.

All fired composites survive; only children are dropped.
"""
from __future__ import annotations

from aimusic_shared.verdicts.models import Verdict

SEVERITY_RANK: dict[str, int] = {
    "win": 0, "minor": 1, "moderate": 2, "severe": 3, "critical": 4,
}

# (slug, suppresses, record)
CompositeHit = tuple[str, list[str], Verdict]


def apply(singles: dict[str, Verdict], composites: list[CompositeHit]) -> list[Verdict]:
    """Return the de-suppressed problem list: surviving singles + every composite,
    with each absorbed child dropped exactly once (awarded to the hottest claimer).
    """
    # Hottest-first so a contested child is absorbed by the strongest composite.
    ordered = sorted(composites, key=lambda c: SEVERITY_RANK[c[2].severity], reverse=True)
    suppressed: set[str] = set()
    for _slug, children, rec in ordered:
        for child in children:
            if child in singles and child not in suppressed:
                suppressed.add(child)
                rec.related_verdict_ids.append(singles[child].problem_id or child)
    survivors = [v for slug, v in singles.items() if slug not in suppressed]
    survivors.extend(rec for _slug, _children, rec in composites)
    return survivors
