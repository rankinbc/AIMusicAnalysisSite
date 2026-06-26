"""``RunTrace`` builder — assembles a structured, diagram-ready JSON record of a
single analysis run's decision flow, with the full input + output payload at
every stage.

Schema (``RunTrace.to_dict()``)::

    {
      "run_id", "analysis_id", "created_at",
      "summary": { phase/problem/route/llm counts },
      "stages": {
        "analysis":    {"input", "output", "phases": [{phase,name,output}, ...]},
        "flatten":     {"input", "output"},
        "identify":    {"input", "decisions": {singles, composites}, "output"},
        "solve":       {"input", "routes", "change_log", "leftover_advice", "output"},
        "llm_routing": [ {request, response, parsed, gate}, ... ],
        "final":       {"verdicts", "chain"}
      }
    }

Every stage entry carries an ``input`` and an ``output`` payload (the analysis
stage's output is the full ``final_json``, decomposed per phase). Only raw audio
sample arrays are excluded — they never appear in ``final_json`` to begin with.

``build_run_trace`` is PURE (no DB, no env) so it's unit-testable; the DB-loading
actor + CLI live in ``app.trace.generate``.
"""
from __future__ import annotations

import gzip
import json
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.solve_lib import solve
from app.solve_lib.router import route
from app.verdict_lib.flatten_analysis import flatten
from app.verdict_lib.rule_engine import evaluate_problems

logger = logging.getLogger(__name__)


def trace_runs_enabled() -> bool:
    """Run tracing is opt-in (verbose; stores full prompts/payloads). Enable via
    ``TRACE_RUNS=1|true|on|yes``. Off by default — never the prod hot path."""
    return os.environ.get("TRACE_RUNS", "").strip().lower() in {"1", "true", "on", "yes"}


def _dump(v: Any) -> Any:
    """JSON-safe dump of a pydantic Verdict (or pass-through for plain dicts)."""
    if hasattr(v, "model_dump"):
        return v.model_dump(mode="json")
    return v


@dataclass
class RunTrace:
    run_id: str
    created_at: str | None = None
    analysis_id: str | None = None
    stages: dict[str, Any] = field(default_factory=dict)
    summary: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "analysis_id": self.analysis_id,
            "created_at": self.created_at,
            "summary": self.summary,
            "stages": self.stages,
        }

    def write(self, out_dir: str | os.PathLike[str], *, gzip_json: bool = True) -> Path:
        """Write the trace under ``out_dir`` as ``<analysis_id|run_id>.json[.gz]``.
        Returns the written path. Gzipped by default — a full per-stage trace is large."""
        out_dir = Path(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        stem = self.analysis_id or self.run_id
        payload = json.dumps(self.to_dict(), indent=2, default=str)
        if gzip_json:
            path = out_dir / f"{stem}.json.gz"
            with gzip.open(path, "wt", encoding="utf-8") as fh:
                fh.write(payload)
        else:
            path = out_dir / f"{stem}.json"
            path.write_text(payload, encoding="utf-8")
        return path


def read_trace(path: str | os.PathLike[str]) -> dict[str, Any]:
    """Read a trace JSON, transparently handling ``.json`` and ``.json.gz``."""
    p = Path(path)
    if p.suffix == ".gz":
        with gzip.open(p, "rt", encoding="utf-8") as fh:
            return json.load(fh)
    return json.loads(p.read_text(encoding="utf-8"))


def build_run_trace(
    *,
    run_id: str,
    created_at: str | None = None,
    final_json: dict[str, Any] | None,
    analysis_id: str | None = None,
    analysis_inputs: dict[str, Any] | None = None,
    persisted_verdicts: list[Any] | None = None,
    llm_calls: list[dict[str, Any]] | None = None,
) -> RunTrace:
    """Deterministically reconstruct the decision trace for one run.

    ``final_json`` is the persisted analysis result (pipeline shape, phases as a
    list). IDENTIFY + SOLVE are recomputed (both deterministic). ``llm_calls`` —
    the live-captured identifier LLM requests/responses — and ``persisted_verdicts``
    are passed through unchanged. Best-effort: a malformed ``final_json`` yields a
    partial trace rather than raising.
    """
    fj: dict[str, Any] = final_json if isinstance(final_json, dict) else {}

    # ── analysis stage: input = run args (or note), output = full final_json ──
    phases_out: list[dict[str, Any]] = []
    raw_phases = fj.get("phases")
    if isinstance(raw_phases, list):
        for p in raw_phases:
            if isinstance(p, dict):
                phases_out.append({
                    "phase": p.get("phase"),
                    "name": p.get("name"),
                    "output": p.get("data"),
                })
    analysis_stage = {
        "input": analysis_inputs or {"note": "reconstructed from persisted final_json"},
        "output": fj,
        "phases": phases_out,
    }

    stages: dict[str, Any] = {"analysis": analysis_stage}

    # ── flatten stage ────────────────────────────────────────────────────────
    try:
        flattened = flatten(fj)
        flattened.setdefault("track_id", analysis_id or run_id)
    except Exception:
        logger.exception("run trace: flatten failed for run=%s", run_id)
        flattened = {}
    stages["flatten"] = {"input": fj, "output": flattened}

    # ── IDENTIFY stage (rule engine, with a decision sink) ───────────────────
    decisions: dict[str, list[Any]] = {"singles": [], "composites": []}
    try:
        problems = evaluate_problems(flattened, trace=decisions)
    except Exception:
        logger.exception("run trace: evaluate_problems failed for run=%s", run_id)
        problems = []
    stages["identify"] = {
        "input": flattened,
        "decisions": decisions,
        "output": [_dump(v) for v in problems],
    }

    # ── SOLVE stage (route decisions + compiled rack) ────────────────────────
    routes: list[dict[str, Any]] = []
    for v in problems:
        try:
            solver = route(v)
        except Exception:
            solver = None
        routes.append({
            "problem_id": v.problem_id,
            "category": v.category,
            "data_tier": v.data_tier,
            "fixable": v.fixable,
            "solver": solver,
        })
    try:
        solved = solve(problems, flattened)
    except Exception:
        logger.exception("run trace: solve failed for run=%s", run_id)
        solved = {"chain": {}, "leftover_advice": [], "change_log": []}
    stages["solve"] = {
        "input": [_dump(v) for v in problems],
        "routes": routes,
        "change_log": solved.get("change_log", []),
        "leftover_advice": solved.get("leftover_advice", []),
        "output": solved.get("chain", {}),
    }

    # ── LLM routing (live-captured; empty until Phase 5 identifiers run) ─────
    llm_routing = list(llm_calls or [])
    stages["llm_routing"] = llm_routing

    # ── final stage ──────────────────────────────────────────────────────────
    final_verdicts = (
        [_dump(v) for v in persisted_verdicts]
        if persisted_verdicts is not None
        else [_dump(v) for v in problems]
    )
    stages["final"] = {"verdicts": final_verdicts, "chain": solved.get("chain", {})}

    summary = {
        "phases": len(phases_out),
        "singles_fired": sum(1 for s in decisions["singles"] if s.get("fired")),
        "composites_fired": sum(1 for c in decisions["composites"] if c.get("fired")),
        "problems": len(problems),
        "routed": sum(1 for r in routes if r.get("solver")),
        "leftover": len(solved.get("leftover_advice", [])),
        "llm_calls": len(llm_routing),
    }

    return RunTrace(
        run_id=run_id,
        created_at=created_at,
        analysis_id=analysis_id,
        stages=stages,
        summary=summary,
    )
