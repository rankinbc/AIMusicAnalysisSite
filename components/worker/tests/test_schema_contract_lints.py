"""Layer-2 enforcement lint: every consumer (rule / prompt / fixture) field
path must resolve in the authoritative ``final_json`` contract, except entries
frozen in the drift baseline. New drift → red; a fixed offender that lingers in
the baseline → red (the ratchet forces the baseline to shrink).

Design: ``PRPs/schema-contract-prevention-design.md``. Modeled on the
dependency-free style of ``test_enforcement_lints.py``.
"""
from __future__ import annotations

import json
from pathlib import Path

from app.verdict_lib.schema_contract import (
    current_drift_offenders,
    diff_new,
    diff_stale,
    scan_sizes,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
BASELINE = REPO_ROOT / "schemas" / "_schema_drift_baseline.json"


def _baseline() -> dict[str, list[str]]:
    return json.loads(BASELINE.read_text(encoding="utf-8"))


def test_no_unbaselined_schema_drift():
    new = diff_new(current_drift_offenders(), _baseline())
    total = sum(len(v) for v in new.values())
    assert total == 0, (
        "New final_json schema drift detected — a consumer references a field "
        "the pipeline does NOT emit. Fix the consumer (use a real path), or if "
        "the pipeline genuinely emits it, regenerate the contract "
        "(`python -m app.tools.build_schema_contract`). Do NOT add to the "
        "baseline to silence this.\n" + json.dumps(new, indent=2)
    )


def test_baseline_has_no_stale_entries():
    stale = diff_stale(current_drift_offenders(), _baseline())
    total = sum(len(v) for v in stale.values())
    assert total == 0, (
        "Baselined drift no longer occurs (you fixed it — thank you). Delete "
        "these lines from schemas/_schema_drift_baseline.json so the ratchet "
        "stays tight:\n" + json.dumps(stale, indent=2)
    )


def test_scan_is_not_vacuous():
    # Fail CLOSED: if files moved and nothing was scanned, the lint must not
    # pass as 'clean'.
    s = scan_sizes()
    assert s["rules"] >= 8, f"too few rules scanned — layout changed? {s}"
    assert s["prompts"] >= 14, f"too few prompt files scanned — layout changed? {s}"
    assert s["fixtures"] >= 3, f"too few fixtures scanned — layout changed? {s}"
