"""Task G3 — the deterministic (non-LLM) coach opening-brief template.

Used whenever the real coach LLM can't run for the brief turn: budget
exhausted (``LlmBudgetExceeded``), a transient gateway failure
(``LlmError``), a degraded analysis, or ``LLM_FAKE=1`` (so the Playwright
smoke can assert on a deterministic brief). The coach must never open with
an error bubble or an empty message — this function guarantees a real,
grounded brief every time.

Pure function: takes the same verdict-dict shape ``coach_actor.
_load_verdicts_for_bundle`` projects (``specialist``, ``severity``,
``category``, ``headline``, ``summary``, ``metric_line``, ``priority_score``,
``suspected``). Never invents a number — every measured value it repeats
already exists verbatim in a verdict's ``headline``/``summary``/
``metric_line``.
"""
from __future__ import annotations

from typing import Any

# A "win" is something the mix already does right, not a problem — never one
# of the top-3 priorities (aimusic_shared.verdicts.models.Severity includes
# "win" alongside critical/severe/moderate/minor). "suspected" verdicts carry
# an unvalidated threshold (placeholder pending a measured corpus) and a
# failed specialist writes the sentinel headline "Specialist failed"
# (components/worker/app/verdict_actor.py) — neither is an actionable finding.
_NOT_A_PROBLEM_SEVERITY = "win"
_FAILED_SENTINEL_HEADLINE = "Specialist failed"
_TOP_N = 3

_NO_FINDINGS_BODY = (
    "I've been through the full analysis and didn't find any standout "
    "problems to flag — a clean pass. Take a look through the findings "
    "below and let me know what you'd like to dig into."
)


def _is_actionable(v: dict[str, Any]) -> bool:
    if v.get("severity") == _NOT_A_PROBLEM_SEVERITY:
        return False
    if v.get("suspected"):
        return False
    if v.get("headline") == _FAILED_SENTINEL_HEADLINE:
        return False
    return True


def build_template_brief(verdicts: list[dict[str, Any]]) -> str:
    """Build a plain-text opening brief straight from the rule-engine /
    specialist findings — no LLM call. Never empty, never invents a number.
    """
    actionable = [v for v in verdicts if _is_actionable(v)]
    actionable.sort(key=lambda v: v.get("priority_score") or 0, reverse=True)
    top = actionable[:_TOP_N]

    if not top:
        return _NO_FINDINGS_BODY

    lines = [
        "I've been through the full analysis. Here's what I found and "
        "where I'd start.",
        "",
        "Top priorities:",
    ]
    for i, v in enumerate(top, start=1):
        headline = v.get("headline") or "Untitled finding"
        detail = " ".join(
            p for p in (v.get("summary"), v.get("metric_line")) if p
        )
        line = f"{i}. {headline}"
        if detail:
            line += f" — {detail}"
        lines.append(line)
    lines.append("")
    lines.append(
        "Take a look through the full findings list below for everything "
        "else I measured."
    )
    return "\n".join(lines)
