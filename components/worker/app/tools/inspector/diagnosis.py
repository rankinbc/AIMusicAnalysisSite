"""Classify why a rule stayed idle: genuine bug vs. legitimately input-gated.

The four analysis inputs (music file [always present], reference track, stems,
and .als project) are optional except the music file, and most uploads are
music-only. A rule that reads a datapoint from a phase that did NOT run because
its optional input was absent is *expected* to be idle — not a bug. A rule that
reads a datapoint absent from a phase that DID run is reading a misnamed or
never-emitted field — a real bug. This module draws that line so the inspector's
gap view doesn't cry wolf on partial-input uploads.
"""
from __future__ import annotations

from typing import Any


def analysis_inputs(flat: dict[str, Any]) -> dict[str, bool]:
    """Which of the four inputs this analysis actually had, from the flattened
    final_json. Music is always present; the rest are optional."""
    p4 = flat.get("phase4") or {}
    p5 = flat.get("phase5") or {}
    return {
        "music": bool(flat.get("phase1")),
        "reference": bool(p5) and p5.get("status") != "skipped",
        "stems": bool(p4.get("stems")),  # {} when no stems were provided
        "als": bool(flat.get("phase8")),
    }


def phase_run_states(flat: dict[str, Any]) -> dict[str, str]:
    """phaseN -> 'ran' | 'skipped' | 'absent', read from the real flattened
    analysis. 'skipped' is an explicit ``status == "skipped"`` (phase5 with no
    reference); 'absent' is a missing/empty phase (e.g. phase8 with no .als)."""
    states: dict[str, str] = {}
    for n in range(1, 10):
        k = f"phase{n}"
        v = flat.get(k)
        if not v or not isinstance(v, dict):
            states[k] = "absent"
        elif v.get("status") == "skipped":
            states[k] = "skipped"
        else:
            states[k] = "ran"
    return states


def diagnose_rule(
    rule_view: dict[str, Any], phase_states: dict[str, str]
) -> tuple[str, str]:
    """Return ``(diagnosis, reason)`` for one rule's trace overlay.

    diagnosis is one of:
      - ``fired``       — the rule produced a verdict
      - ``in_range``    — every read-path resolved; thresholds simply not crossed
      - ``bug``         — reads a field absent from a phase that DID run
                          (misnamed / never-emitted), or a bare non-output key
      - ``input_gated`` — the only missing read-paths come from a phase that was
                          skipped/absent because its optional input wasn't provided
    """
    if rule_view.get("fired"):
        return ("fired", "rule produced a verdict")
    res = rule_view.get("path_resolution", {})
    missing = [p for p, r in res.items() if r == "missing"]
    if not missing:
        return ("in_range", "all inputs resolved; thresholds not crossed")
    bug: list[str] = []
    gated: list[str] = []
    for p in missing:
        if not p.startswith("phase"):
            # bare param (e.g. genre_hint) — never a pipeline output; the rule
            # should read a real phase output instead.
            bug.append(p)
            continue
        seg = p.split(".")[0]
        if phase_states.get(seg, "absent") == "ran":
            bug.append(p)  # phase ran but this field is not emitted under that name
        else:
            gated.append(p)  # phase skipped/absent → field legitimately unavailable
    if bug:
        return ("bug", "reads field(s) absent from a populated phase: " + ", ".join(bug))
    return (
        "input_gated",
        "needs a datapoint from a skipped/absent phase: " + ", ".join(gated),
    )
