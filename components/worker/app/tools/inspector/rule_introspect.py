"""Introspect the rule engine for the inspector.

- `read_paths_for_rule` statically extracts the datapoints a rule reads (so a
  non-firing rule still reveals what it *would* read — the basis for gap
  detection in spec §6.1).
- `run_rule` re-runs a rule deterministically against a flattened final_json.
- `resolve_path` reports whether a datapoint is present / null / missing.

Caveat: the AST extractor handles the current rule idioms (simple ``_phase``
assignment + literal ``Evidence(metric=...)``); it will not capture
walrus/tuple-unpack binds, chained ``_phase(a, "pN").get(...)`` expressions,
or non-literal (f-string) metric values — every Problem-engine rule carries at
least one literal Evidence metric, so no rule goes uncatalogued.
"""
from __future__ import annotations

import ast
import inspect
import textwrap
from typing import Any, Callable

from app.verdict_lib import rule_engine


def _safe_source(fn: Callable) -> str:
    try:
        return textwrap.dedent(inspect.getsource(fn))
    except (OSError, TypeError):
        return ""


class _ReadPathVisitor(ast.NodeVisitor):
    def __init__(self) -> None:
        self.var_to_phase: dict[str, str] = {}
        self.paths: set[str] = set()

    def visit_Assign(self, node: ast.Assign) -> None:
        # X = _phase(analysis, "phaseN")
        v = node.value
        if (
            isinstance(v, ast.Call)
            and isinstance(v.func, ast.Name)
            and v.func.id == "_phase"
            and len(v.args) == 2
            and isinstance(v.args[1], ast.Constant)
            and isinstance(v.args[1].value, str)
        ):
            phase = v.args[1].value
            for tgt in node.targets:
                if isinstance(tgt, ast.Name):
                    self.var_to_phase[tgt.id] = phase
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        # <var>.get("key")  /  analysis.get("key")
        f = node.func
        if (
            isinstance(f, ast.Attribute)
            and f.attr == "get"
            and node.args
            and isinstance(node.args[0], ast.Constant)
            and isinstance(node.args[0].value, str)
        ):
            key = node.args[0].value
            if isinstance(f.value, ast.Name):
                base = f.value.id
                if base in self.var_to_phase:
                    self.paths.add(f"{self.var_to_phase[base]}.{key}")
                elif base == "analysis":
                    self.paths.add(key)
        # Evidence(metric="phaseN.key")
        if isinstance(f, ast.Name) and f.id == "Evidence":
            for kw in node.keywords:
                if (
                    kw.arg == "metric"
                    and isinstance(kw.value, ast.Constant)
                    and isinstance(kw.value.value, str)
                ):
                    self.paths.add(kw.value.value)
        self.generic_visit(node)


def read_paths_for_rule(fn: Callable) -> set[str]:
    src = _safe_source(fn)
    if not src:
        return set()
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return set()
    visitor = _ReadPathVisitor()
    visitor.visit(tree)
    return visitor.paths


def resolve_path(flattened: dict[str, Any], path: str) -> str:
    cur: Any = flattened
    for seg in path.split("."):
        if not isinstance(cur, dict) or seg not in cur:
            return "missing"
        cur = cur[seg]
    return "null" if cur is None else "present"


def run_rule(fn: Callable, flattened: dict[str, Any]) -> dict[str, Any]:
    try:
        verdict = fn(flattened)
    except Exception as exc:  # a rule that raises on this analysis is itself a finding
        return {"fired": False, "verdict": None, "error": f"{type(exc).__name__}: {exc}"}
    return {"fired": verdict is not None, "verdict": verdict, "error": None}


def rule_catalog() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for slug, fn in rule_engine._SINGLES:
        out.append({
            "name": slug,
            "doc": (fn.__doc__ or "").strip(),
            "read_paths": sorted(read_paths_for_rule(fn)),
        })
    return sorted(out, key=lambda e: e["name"])
