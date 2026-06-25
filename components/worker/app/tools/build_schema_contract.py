"""Generate the authoritative ``final_json`` path contract (Layer 1).

Reproducible from committed inputs under ``schemas/``:

  - ``schemas/samples/*.final_json.json`` — real production ``final_json`` blobs
    (full ``{grade, phases:[...], ...}`` shape; flattened to ``phaseN.*`` here).
  - ``schemas/samples/phase<N>_*.data.json`` — a single phase's ``data`` payload
    (the analysis golden snapshots for stems/reference, which no production row
    ever exercised). Leaves are prefixed with ``phase<N>.``.
  - ``schemas/contract_extras.json`` — ``dynamic_prefixes`` (runtime-keyed
    containers), ``manual_leaves`` (declared-but-empty-in-samples), and
    ``bare_top_level_allowed`` (runtime-injected non-final_json keys).

Writes ``schemas/final_json.contract.json``.

Usage (from components/worker):
    python -m app.tools.build_schema_contract            # regenerate the manifest
    python -m app.tools.build_schema_contract --write-baseline   # (re)freeze drift baseline
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from app.verdict_lib.flatten_analysis import flatten

REPO_ROOT = Path(__file__).resolve().parents[4]
SCHEMAS = REPO_ROOT / "schemas"
SAMPLES = SCHEMAS / "samples"
EXTRAS = SCHEMAS / "contract_extras.json"
CONTRACT = SCHEMAS / "final_json.contract.json"
BASELINE = SCHEMAS / "_schema_drift_baseline.json"

_PHASE_DATA_RE = re.compile(r"^(phase[1-9])_.*\.data\.json$")


def _leaves(obj, pre: str = "") -> set[str]:
    """Dotted leaf paths; every array level collapses to ``[]``."""
    out: set[str] = set()
    if isinstance(obj, dict):
        if not obj:  # empty dict is itself a (container) leaf
            out.add(pre)
        for k, v in obj.items():
            out |= _leaves(v, f"{pre}.{k}" if pre else k)
    elif isinstance(obj, list):
        for it in obj:
            out |= _leaves(it, pre + "[]")
    else:
        out.add(pre)
    return out


def _observed_leaves() -> tuple[set[str], list[str]]:
    leaves: set[str] = set()
    used: list[str] = []
    for p in sorted(SAMPLES.glob("*.json")):
        obj = json.loads(p.read_text(encoding="utf-8"))
        m = _PHASE_DATA_RE.match(p.name)
        if m:
            leaves |= _leaves(obj, m.group(1))
        else:
            leaves |= _leaves(flatten(obj))
        used.append(p.name)
    return leaves, used


def build_contract() -> dict:
    extras = json.loads(EXTRAS.read_text(encoding="utf-8"))
    dynamic_prefixes = sorted(extras.get("dynamic_prefixes", []))
    observed, used = _observed_leaves()
    leaves = observed | set(extras.get("manual_leaves", []))
    # Drop leaves already covered by a dynamic prefix (e.g. per-stem role keys) —
    # the prefix validates that subtree; enumerating runtime keys is noise.
    def covered(lf: str) -> bool:
        return any(lf == dp or lf.startswith(dp + ".") or lf.startswith(dp + "[")
                   for dp in dynamic_prefixes)
    leaves = {lf for lf in leaves if lf and not covered(lf)}
    return {
        "_comment": "AUTHORITATIVE final_json path contract. Regenerate with "
                    "`python -m app.tools.build_schema_contract`. Do not hand-edit "
                    "leaf_paths — edit the samples or schemas/contract_extras.json.",
        "generated_from": used,
        "bare_top_level_allowed": sorted(extras.get("bare_top_level_allowed", [])),
        "dynamic_prefixes": dynamic_prefixes,
        "leaf_paths": sorted(leaves),
    }


def write_contract() -> None:
    CONTRACT.write_text(json.dumps(build_contract(), indent=2) + "\n", encoding="utf-8")
    print(f"wrote {CONTRACT.relative_to(REPO_ROOT)} "
          f"({len(json.loads(CONTRACT.read_text())['leaf_paths'])} leaves)")


def write_baseline() -> None:
    # Imported here so the manifest can be built before the lint module exists.
    from app.verdict_lib.schema_contract import current_drift_offenders  # noqa: PLC0415
    offenders = current_drift_offenders()
    BASELINE.write_text(json.dumps(offenders, indent=2) + "\n", encoding="utf-8")
    counts = {k: len(v) for k, v in offenders.items()}
    print(f"wrote {BASELINE.relative_to(REPO_ROOT)} {counts}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="build_schema_contract")
    ap.add_argument("--write-baseline", action="store_true",
                    help="recompute schemas/_schema_drift_baseline.json from current offenders")
    args = ap.parse_args(argv)
    write_contract()
    if args.write_baseline:
        write_baseline()
    return 0


if __name__ == "__main__":
    sys.exit(main())
