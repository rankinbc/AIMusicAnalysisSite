from __future__ import annotations
from collections import OrderedDict
from typing import Iterable

from aimusic_shared.verdicts.models import Severity, Verdict


_SEVERITY_RANK: dict[Severity, int] = {
    "critical": 5, "severe": 4, "moderate": 3, "minor": 2, "win": 1
}


def _primary_metric(v: Verdict) -> str:
    return v.evidence[0].metric if v.evidence else ""


def _merge_pair(a: Verdict, b: Verdict) -> Verdict:
    """Merge b into a. Prefers rule-engine evidence; longer text; higher rank."""
    higher = a if _SEVERITY_RANK[a.severity] >= _SEVERITY_RANK[b.severity] else b
    other = b if higher is a else a

    # Sources: union, preserving order with `a` first
    merged_sources: list[str] = []
    for s in list(a.sources) + list(b.sources):
        if s not in merged_sources:
            merged_sources.append(s)

    # Evidence: union, dedupe by metric path
    by_path: OrderedDict[str, object] = OrderedDict()
    rule_first_evs = (
        list(a.evidence) if "rule_engine" in a.sources else list(b.evidence)
    )
    other_evs = (
        list(b.evidence) if "rule_engine" in a.sources else list(a.evidence)
    )
    for ev in rule_first_evs + other_evs:
        by_path.setdefault(ev.metric, ev)

    # Headline + summary: prefer rule_engine if present (templated, stable),
    # else the longer string
    if "rule_engine" in a.sources:
        headline = a.headline if len(a.headline) >= len(b.headline) else b.headline
        summary = a.summary if len(a.summary) >= len(b.summary) else b.summary
    elif "rule_engine" in b.sources:
        headline = b.headline if len(b.headline) >= len(a.headline) else a.headline
        summary = b.summary if len(b.summary) >= len(a.summary) else a.summary
    else:
        headline = a.headline if len(a.headline) >= len(b.headline) else b.headline
        summary = a.summary if len(a.summary) >= len(b.summary) else b.summary

    # Fix: rule_engine fix wins, else higher confidence
    if a.fix is not None and "rule_engine" in a.sources:
        chosen_fix = a.fix
    elif b.fix is not None and "rule_engine" in b.sources:
        chosen_fix = b.fix
    elif a.fix is None:
        chosen_fix = b.fix
    elif b.fix is None:
        chosen_fix = a.fix
    else:
        chosen_fix = a.fix if a.confidence >= b.confidence else b.fix

    # Related: union
    related = list(dict.fromkeys(list(a.related_verdict_ids) + list(b.related_verdict_ids)))

    return higher.model_copy(update={
        "sources": merged_sources,
        "evidence": list(by_path.values()),
        "headline": headline,
        "summary": summary,
        "fix": chosen_fix,
        "confidence": max(a.confidence, b.confidence),
        "priority_score": max(a.priority_score, b.priority_score),
        "related_verdict_ids": related,
    })


def dedupe_verdicts(verdicts: Iterable[Verdict]) -> list[Verdict]:
    """Merge verdicts that share (category, primary metric path).
    Returns a new list, preserving first-seen order of merged groups."""
    bucket: OrderedDict[tuple[str, str], Verdict] = OrderedDict()
    for v in verdicts:
        key = (v.category, _primary_metric(v))
        if key in bucket:
            bucket[key] = _merge_pair(bucket[key], v)
        else:
            bucket[key] = v
    return list(bucket.values())
