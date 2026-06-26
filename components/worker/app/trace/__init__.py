"""Run-trace harness — a decision-layer-native record of how ONE analysis run
flowed from raw phase data → IDENTIFY (rule engine) → SOLVE (fix rack) → LLM
identifiers, capturing the full input/output payload at every stage.

This is a clean build, NOT the old ``inspector`` (which was built on the prior
analysis system). The trace is assembled deterministically by ``build_run_trace``
from a persisted ``final_json`` (the rule engine + solver are deterministic, so
IDENTIFY/SOLVE are recomputed rather than threaded live through two actors). The
only non-deterministic part — live LLM calls — is captured by the identifier
stage and passed in via ``llm_calls`` (see Phase 5).

``app.trace.generate`` adds the DB-loading actor + CLI; ``app.trace.render_flow``
(Phase 7) turns a trace JSON into a Mermaid/HTML flow diagram.
"""
from __future__ import annotations

from .run_trace import (
    RunTrace,
    build_run_trace,
    read_trace,
    trace_runs_enabled,
)

__all__ = ["RunTrace", "build_run_trace", "read_trace", "trace_runs_enabled"]
