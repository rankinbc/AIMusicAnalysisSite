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
        f"```json\n{json.dumps(analysis, indent=2, default=str)}\n```\n\n"
        "Return only the verdicts JSON object as specified in your instructions."
    )


def build_triage_user_message(
    analysis: dict[str, Any], rule_verdicts: list[Any] | None = None
) -> str:
    """Triage user message: grounding preamble + analysis + rule-engine findings.

    ``rule_verdicts`` is the rule-engine output (legacy api orchestrator path);
    the worker lazy-fire path never runs the rule engine and passes ``None``,
    which renders an empty ``rule_engine_findings`` list. Each verdict is
    duck-typed for ``category`` / ``severity`` / ``headline`` to avoid a model
    import cycle.
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
        f"```json\n{json.dumps(payload, indent=2, default=str)}\n```\n\n"
        "Return only the routing-plan JSON object."
    )
