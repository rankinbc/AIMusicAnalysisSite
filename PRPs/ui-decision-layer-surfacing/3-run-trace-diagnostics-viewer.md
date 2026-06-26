name: "Run-trace diagnostics viewer (OPTIONAL / dev-facing)"
description: |
  Surface the per-run decision trace (full per-stage input/output payloads + LLM
  routing) and its flow diagram in a dev/diagnostics UI. Lower priority than PRPs
  1-2 — the trace is currently a file artifact, not user-facing.

## Goal

The run-trace harness records, for one analysis, the FULL input/output payload of
every decision stage (analysis phases → IDENTIFY → SOLVE → LLM routing) to a gzipped
JSON, and a generator renders it to a Mermaid flow diagram. Today this lives only as
a worker file artifact. Optionally surface it as an in-app diagnostics view so a
developer / power user can see exactly how a run produced its findings.

## Why

- Debuggability: "why did this track get these findings/fixes?" is answerable from the
  trace (per-rule fire/skip, suppression, route decisions, the exact LLM prompt+response).
- It's the visualization the trace + diagram were built for.

## What (decide the surface first)

This is **dev/diagnostics**, not core user UX. Pick a surface:
- **(Recommended) A "Diagnostics" affordance on the Results page** (gated to dev / a
  feature flag) that fetches the run trace and renders the flow + collapsible stage
  payloads — mirroring the self-contained HTML the generator already produces.
- Or a standalone internal tool / download link.

### Success Criteria
- [ ] Given an analysis with a trace, the view shows the flow (input metrics → fired
      rules → composites/suppression → solvers → rack) + per-stage payloads.
- [ ] LLM routing entries show the model + (collapsed) prompt/response.
- [ ] Gated so it never appears for normal end users by default.

## All Needed Context

```yaml
- file: components/worker/app/trace/run_trace.py
  why: The trace schema (to_dict): stages {analysis, flatten, identify, solve, llm_routing,
       final}, each with input/output payloads + a summary. write() gzips to
       output/worker/<date>_run-traces/<analysis_id>.json.gz; there's a note to optionally
       stash it on the analysis row for the BFF to serve.
- file: components/worker/app/trace/render_flow.py
  why: render_mermaid + render_html already produce the diagram + a self-contained HTML
       explorer. The frontend can either reuse the Mermaid string or re-derive nodes/edges
       from the stages.
- file: components/worker/app/trace/generate.py
  why: generate_run_trace(analysis_id) builds + writes the trace (gated by TRACE_RUNS).
- file: components/frontend-spectr-v2/src/features/results/RawTab.tsx
  why: Pattern for a dev/raw data tab in the Results UI to mirror.
```

### Key decisions to make (flag for the implementer)
```text
# DELIVERY: the trace is a worker file artifact today. To serve it, EITHER
#   (a) stash trace JSON on the analyses row (run_trace.write already hints this) +
#       a BFF GET /reports/{jobId}/run-trace endpoint, OR
#   (b) a download-only endpoint that streams the gz file.
#   (a) is cleaner for an in-app viewer.
# SIZE/PII: traces carry FULL payloads incl. LLM prompts — gate behind dev/feature flag,
#   don't ship to end users, and don't index/cache externally.
# RENDER: reuse the Mermaid string from render_flow (render it client-side with a Mermaid
#   lib) OR re-implement a lightweight node/edge view from stages. Prefer the collapsible
#   stage-payload explorer (the HTML generator's approach) — it's the high-signal part.
```

## Implementation Blueprint (sketch — refine after choosing the surface)

```yaml
Task 1 — backend exposure
  - stash trace JSON on the analyses row when TRACE_RUNS is on (run_trace.write)
  - BFF: GET /reports/{jobId}/run-trace -> the trace JSON (dev/flag gated)

Task 2 — frontend viewer
  - a flag-gated "Diagnostics" tab/affordance that fetches the trace
  - render: flow (Mermaid or derived) + collapsible per-stage input/output payloads
  - LLM routing: model + collapsed prompt/response
```

## Validation Loop
```bash
# Worker (trace already covered)
cd components/worker && python -m pytest tests/trace/ -q
# Frontend
cd components/frontend-spectr-v2 && npx tsc --noEmit && npm run lint && npm run build && npx vitest run
```

## Notes
- Strictly optional; ship PRPs 1-2 first. This is a diagnostics power-tool, not core UX.
- If a Mermaid renderer dependency is undesirable, the generator's HTML explorer
  (`render_html`) is self-contained and can be surfaced via a download/iframe instead.
