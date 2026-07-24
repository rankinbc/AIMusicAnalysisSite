"""Authoritative input-provenance grounding for LLM prompts.

A bare mix upload still carries phase-4 (stems) and phase-5 (reference)
scaffolding in ``final_json`` — frequently ``status: "skipped"`` (no reference)
or ``status: "failed"`` (stems attached but unreadable). A real model reads
that scaffolding and narrates stems / a reference track the user never
provided. ``LLM_FAKE`` hid this because the canned replies ignored it.

This module derives the ground truth of which inputs are actually present and
renders an authoritative preamble so the model never invents absent inputs.
Pure (no DB / no LLM) → unit-testable in isolation.
"""
from __future__ import annotations

import json
from typing import Any


def _stems_state(analysis: dict[str, Any]) -> str:
    """``"ok"`` (usable stems) | ``"failed"`` (attached but unreadable) |
    ``"absent"`` (none provided)."""
    phase4 = analysis.get("phase4")
    if not isinstance(phase4, dict):
        return "absent"
    stems = phase4.get("stems")
    if not isinstance(stems, dict):
        return "absent"
    status = stems.get("status")
    if status == "ok":
        return "ok"
    if status == "failed":
        return "failed"
    return "absent"


def als_state(analysis: dict[str, Any]) -> str:
    """``"ok"`` (an .als project map is present) | ``"absent"`` (no .als).

    Mirrors :func:`_stems_state` / the ``phase4.stems.status == "ok"`` gate. The
    authoritative map is phase 8 (``analyze_als``): present, status ok, and with at
    least one parsed track.
    """
    phase8 = analysis.get("phase8")
    if not isinstance(phase8, dict):
        return "absent"
    # `flatten()` stores only the phase `data`, so `status` is usually absent here;
    # when it IS present (raw phase-result shape) an explicit non-ok value means no
    # usable map. Either way we require a non-empty parsed track list.
    status = phase8.get("status")
    if status is not None and status != "ok":
        return "absent"
    tracks = phase8.get("tracks")
    if isinstance(tracks, list) and tracks:
        return "ok"
    return "absent"


def als_project_map(analysis: dict[str, Any]) -> dict[str, list[str]]:
    """Authoritative ``{track_name: [device_names]}`` map from phase 8.

    Empty dict when no usable .als is present — callers gate on truthiness, so an
    absent .als is a pure no-op (no grounding block, no validator branch)."""
    if als_state(analysis) != "ok":
        return {}
    phase8 = analysis.get("phase8") or {}
    out: dict[str, list[str]] = {}
    for t in phase8.get("tracks") or []:
        if not isinstance(t, dict):
            continue
        name = t.get("name")
        if not isinstance(name, str) or not name:
            continue
        devices = [d for d in (t.get("devices") or []) if isinstance(d, str)]
        out[name] = devices
    return out


def als_grounding_block(analysis: dict[str, Any]) -> str:
    """Authoritative track→device listing for the user message.

    Returns ``""`` when no .als is present so the message stays byte-identical to
    the role-level path. When present, lists the EXACT track names (and their
    existing devices) the model is allowed to cite — the "no hallucinated names"
    guard, the same preamble-instruction mechanism used for stems/reference."""
    track_map = als_project_map(analysis)
    if not track_map:
        return ""
    lines = [
        "=== ABLETON PROJECT MAP (authoritative — the ONLY track & device names you "
        "may cite) ===",
        "An Ableton .als project was provided. Give project-specific advice: name the "
        "exact track (and an existing device on it) your fix applies to. For a "
        "track-specific fix set fix.target = {\"type\": \"track\", \"name\": "
        "\"<one of the exact track names below>\"}. NEVER invent a track or device "
        "name that is not listed here.",
    ]
    for name, devices in track_map.items():
        dev = ", ".join(devices) if devices else "(no devices)"
        lines.append(f"- Track {name!r}: [{dev}]")
    return "\n".join(lines) + "\n"


def _reference_present(analysis: dict[str, Any]) -> bool:
    phase5 = analysis.get("phase5")
    if not isinstance(phase5, dict):
        return False
    if phase5.get("status") in (None, "skipped"):
        return False
    if phase5.get("stem_reference_comparison") == "unavailable":
        return False
    return bool(phase5.get("deltas"))


def input_provenance(analysis: dict[str, Any]) -> dict[str, Any]:
    """Structured ground truth of provided inputs (for the coach bundle)."""
    return {
        "mix": True,
        "stems": _stems_state(analysis),       # "ok" | "failed" | "absent"
        "reference": _reference_present(analysis),
    }


def grounding_preamble(analysis: dict[str, Any]) -> str:
    """Authoritative preamble prepended to specialist/triage user messages."""
    p = input_provenance(analysis)
    stems = p["stems"]
    if stems == "ok":
        stems_line = "YES — separated stems were provided and analyzed."
    elif stems == "failed":
        stems_line = (
            "PROVIDED BUT UNREADABLE — stems were attached but failed to load, so "
            "there is NO valid per-stem data. Do NOT discuss individual stems, stem "
            "balance, or per-stem clashes."
        )
    else:
        stems_line = (
            "NO — no separated stems were provided. Do NOT discuss individual stems, "
            "stem balance, or per-stem clashes."
        )
    ref_line = (
        "YES — a reference track was provided and compared."
        if p["reference"]
        else "NO — no reference track was provided. Do NOT mention, infer, or compare "
        "against any reference, benchmark, or target track — there is none."
    )
    return (
        "=== INPUTS ACTUALLY PROVIDED (authoritative — overrides anything implied by "
        "the JSON below) ===\n"
        "- Mix audio: YES.\n"
        f"- Separated stems: {stems_line}\n"
        f"- Reference track: {ref_line}\n"
        "Any skipped / failed / placeholder section in the JSON is an input that was "
        "NOT provided — treat it as absent, never as a finding, and never invent data "
        "for it.\n"
    )


def build_specialist_user_message(analysis: dict[str, Any], focus: str) -> str:
    """Specialist user message: grounding preamble + the analysis JSON.

    Shared by the worker ``verdict_actor`` and the ``verdict_lib.specialists``
    library path — keep this the single source so the two never drift.
    """
    return (
        f"Analyze this mix. Triage focus: {focus}\n\n"
        f"{grounding_preamble(analysis)}\n"
        f"{als_grounding_block(analysis)}"
        f"```json\n{json.dumps(analysis, indent=2, default=str)}\n```\n\n"
        "Return only the verdicts JSON object as specified in your instructions."
    )


def build_triage_user_message(
    analysis: dict[str, Any], rule_verdicts: list[Any] | None = None
) -> str:
    """Triage user message: grounding preamble + analysis + rule-engine findings.

    ``rule_verdicts`` is the rule-engine output. The worker's ``run_triage``
    actor now queries the already-persisted rule-engine ``Verdict`` rows
    (Phase C2 of ``analyze_audio_job`` runs the rule engine unconditionally
    before Triage fires) and passes them through; callers that have no
    rule-engine rows yet pass ``None``, which renders an empty
    ``rule_engine_findings`` list. Each verdict is duck-typed for
    ``category`` / ``severity`` / ``headline`` to avoid a model import cycle.
    """
    rule_summary = [
        {
            "specialist": "rule_engine",
            "category": v.category,
            "severity": v.severity,
            "headline": v.headline,
        }
        for v in (rule_verdicts or [])
    ]
    payload = {
        "analysis": analysis,
        "rule_engine_findings": rule_summary,
    }
    return (
        "Triage this mix.\n\n"
        f"{grounding_preamble(analysis)}\n"
        f"{als_grounding_block(analysis)}"
        f"```json\n{json.dumps(payload, indent=2, default=str)}\n```\n\n"
        "Return only the routing-plan JSON object."
    )
