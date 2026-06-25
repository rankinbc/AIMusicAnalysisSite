"""Assemble JSON-able view models for the inspector (catalog + trace)."""
from __future__ import annotations

from typing import Any

from app.verdict_lib.flatten_analysis import flatten
from app.verdict_lib.prompt_loader import SPECIALIST_SLUGS
from app.verdict_lib import rule_engine

from .diagnosis import analysis_inputs, diagnose_rule, phase_run_states
from .loader import RawTrace
from .rule_introspect import read_paths_for_rule, resolve_path, rule_catalog, run_rule
from .stage_map import STAGE_MAP, declared_output_paths, stage_for_path


def _stages_view() -> list[dict[str, Any]]:
    return [
        {"key": s.key, "title": s.title, "narration": s.narration,
         "inputs": list(s.inputs), "outputs": list(s.outputs)}
        for s in STAGE_MAP
    ]


def _rules_with_producers() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for entry in rule_catalog():
        producers = {p: stage_for_path(p) for p in entry["read_paths"]}
        out.append({**entry, "producers": producers})
    return out


def _datapoint_consumers() -> list[dict[str, Any]]:
    # Map every declared output → its producer + the rules that read it.
    rule_reads = {fn.__name__: read_paths_for_rule(fn) for fn in rule_engine._RULES}
    rows: list[dict[str, Any]] = []
    for dp in sorted(declared_output_paths()):
        consumers = sorted(name for name, paths in rule_reads.items() if dp in paths)
        rows.append({"datapoint": dp, "producer": stage_for_path(dp), "consumers": consumers})
    return rows


def _static_gaps(rules: list[dict[str, Any]]) -> dict[str, Any]:
    unmapped = [
        {"rule": r["name"], "path": path}
        for r in rules
        for path, producer in r["producers"].items()
        if producer is None and "." in path  # ignore bare top-level keys (genre_hint, track_id)
    ]
    return {"unmapped_rule_paths": unmapped}


def build_catalog_model() -> dict[str, Any]:
    rules = _rules_with_producers()
    return {
        "mode": "catalog",
        "stages": _stages_view(),
        "rules": rules,
        "specialists": sorted(SPECIALIST_SLUGS),
        "datapoint_consumers": _datapoint_consumers(),
        "static_gaps": _static_gaps(rules),
    }


def build_trace_model(raw: RawTrace) -> dict[str, Any]:
    model = build_catalog_model()
    model["mode"] = "trace"

    flat = flatten(raw.final_json)
    flat.setdefault("track_id", raw.id)

    # Per-rule overlay: fired/not + per-path resolution + idle diagnosis.
    model["inputs"] = analysis_inputs(flat)
    states = phase_run_states(flat)
    _rules_by_name = {f.__name__: f for f in rule_engine._RULES}
    summary = {"fired": 0, "in_range": 0, "bug": 0, "input_gated": 0}
    for r in model["rules"]:
        fn = _rules_by_name[r["name"]]
        run = run_rule(fn, flat)
        r["fired"] = run["fired"]
        r["error"] = run["error"]
        r["path_resolution"] = {p: resolve_path(flat, p) for p in r["read_paths"]}
        diagnosis, reason = diagnose_rule(r, states)
        r["diagnosis"] = diagnosis
        r["diagnosis_reason"] = reason
        summary[diagnosis] = summary.get(diagnosis, 0) + 1
    model["rule_diagnosis_summary"] = summary

    # Header.
    model["header"] = {
        "id": raw.id,
        "job_id": raw.job_id,
        "song_name": raw.song_name,
        "created_at": raw.created_at.isoformat() if raw.created_at else None,
        "overall_score": raw.final_json.get("overall_score"),
        "grade": raw.final_json.get("grade"),
    }

    # Routing + specialist status.
    model["routing_plan"] = raw.routing_plan
    selected = set()
    if isinstance(raw.routing_plan, dict):
        for item in raw.routing_plan.get("specialists_to_run") or []:
            name = item.get("name") if isinstance(item, dict) else item
            if name:
                selected.add(name)
    model["specialist_status"] = {
        slug: ("ran" if slug in selected else "not_selected")
        for slug in sorted(SPECIALIST_SLUGS)
    }
    model["verdicts"] = raw.verdicts
    return model
