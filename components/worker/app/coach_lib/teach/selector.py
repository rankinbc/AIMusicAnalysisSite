"""Select the teaching units most relevant to a teach-mode question.

Pure function: deterministic pre-filter (keyword/alias hits + a boost for units
whose category matches the track's top findings), capped, fail-soft. The LLM
does the final relevance among the candidates. NEVER raises — junk input or no
match returns an empty unit list (the prompt then teaches general craft).
"""
from __future__ import annotations

from .models import TeachingUnit

_ALIAS_HIT = 2          # weight per alias/keyword hit in the question
_SLUG_HIT = 1           # weight when the slug's words appear in the question
_CATEGORY_BOOST = 1     # weight when the unit's category is among the findings


def select_units(
    question: str,
    verdicts: list[dict] | None,
    units: list[TeachingUnit],
    *,
    cap: int = 3,
) -> tuple[list[TeachingUnit], list[str]]:
    """Return ``(selected_units, catalog)``.

    - ``selected_units``: up to ``cap`` units with score > 0, best first.
      A unit scores on alias/keyword hits against ``question`` plus a boost
      when its category appears among ``verdicts[*]["category"]`` — so lessons
      gravitate to what's actually wrong with this track even when the question
      is vague.
    - ``catalog``: titles of ALL units (so the prompt can say what it can and
      cannot teach).
    """
    q = (question or "").lower()
    finding_categories = {
        v.get("category")
        for v in (verdicts or [])
        if isinstance(v, dict) and v.get("category")
    }

    scored: list[tuple[int, str, TeachingUnit]] = []
    for u in units:
        score = 0
        for alias in u.aliases:
            if alias and alias in q:
                score += _ALIAS_HIT
        if u.slug.replace("_", " ") in q:
            score += _SLUG_HIT
        if u.category in finding_categories:
            score += _CATEGORY_BOOST
        if score > 0:
            scored.append((score, u.slug, u))

    # Highest score first; stable tie-break by slug for determinism.
    scored.sort(key=lambda t: (-t[0], t[1]))
    selected = [u for _, _, u in scored[:cap]]
    catalog = [u.title for u in units]
    return selected, catalog
