"""Flow-diagram generator (Phase 7) — turn a run-trace JSON into a visual flow.

Emits:
  * a **Mermaid** flowchart (``<stem>.flow.md``) — versionable, renders on GitHub.
    Nodes: analysis -> IDENTIFY -> fired problems (with absorbed-children edges to
    composites) -> solvers -> Fix Rack, plus leftover advice and LLM calls.
  * an optional **self-contained HTML explorer** (``<stem>.flow.html``, ``--html``)
    — no external deps: the Mermaid source plus collapsible per-stage input/output
    payloads for deep inspection.

CLI::

    python -m app.trace.render_flow <trace.json[.gz]> [--html] [--out-dir DIR]
"""
from __future__ import annotations

import html as _html
import json
import re
from pathlib import Path
from typing import Any

from .run_trace import read_trace


def _sid(prefix: str, slug: str) -> str:
    """A Mermaid-safe node id."""
    return f"{prefix}_{re.sub(r'[^A-Za-z0-9_]', '_', slug or 'x')}"


def _label(text: str) -> str:
    """Safe text for a Mermaid ``[\"...\"]`` label."""
    return str(text).replace('"', "'").replace("\n", " ").replace("[", "(").replace("]", ")")


def _slug_of(problem_id: str | None) -> str:
    pid = problem_id or ""
    return pid.split(".")[1] if pid.count(".") >= 1 else pid


def render_mermaid(trace: dict[str, Any]) -> str:
    """Build a Mermaid flowchart string from a trace dict."""
    stages = trace.get("stages", {})
    summary = trace.get("summary", {})
    ident = stages.get("identify", {})
    solve = stages.get("solve", {})

    lines = ["flowchart TD"]
    lines.append(f'  A["Analysis - {summary.get("phases", 0)} phases"]')
    lines.append('  A --> ID["IDENTIFY (rule engine)"]')

    # Survivors (post-suppression) become problem nodes off IDENTIFY.
    survivors: dict[str, dict[str, Any]] = {}
    for p in ident.get("output", []):
        slug = _slug_of(p.get("problem_id"))
        survivors[slug] = p
        nid = _sid("P", slug)
        tag = "" if p.get("fixable") else " (obs)"
        lines.append(f'  {nid}["{_label(slug)} - {p.get("severity")}{tag}"]')
        lines.append(f"  ID --> {nid}")

    # Suppressed children: fired singles that didn't survive -> dashed edge to the
    # composite that absorbed them.
    decisions = ident.get("decisions", {})
    fired_singles = {s.get("slug") for s in decisions.get("singles", []) if s.get("fired")}
    for c in decisions.get("composites", []):
        if not c.get("fired"):
            continue
        comp_id = _sid("P", c.get("slug", ""))
        for child in c.get("suppresses", []):
            if child in fired_singles and child not in survivors:
                child_id = _sid("S", child)
                lines.append(f'  {child_id}["{_label(child)}"]:::dim')
                lines.append(f"  {child_id} -. absorbed .-> {comp_id}")

    # Routes -> solver nodes -> the Fix Rack.
    solvers_used: set[str] = set()
    for r in solve.get("routes", []):
        solver = r.get("solver")
        slug = _slug_of(r.get("problem_id"))
        if not solver or slug not in survivors:
            continue
        snode = _sid("SOLVE", solver)
        lines.append(f'  {_sid("P", slug)} --> {snode}["solver: {_label(solver)}"]')
        solvers_used.add(snode)
    if solvers_used:
        modules = (solve.get("output") or {}).get("modules", {})
        enabled = [m for m, st in modules.items() if isinstance(st, dict) and st.get("enabled")]
        rack = "Fix Rack: " + (", ".join(enabled) if enabled else "(empty)")
        lines.append(f'  RACK["{_label(rack)}"]')
        for snode in sorted(solvers_used):
            lines.append(f"  {snode} --> RACK")

    leftover = solve.get("leftover_advice", [])
    if leftover:
        lines.append(f'  LEFT["leftover advice ({len(leftover)})"]:::dim')

    for i, call in enumerate(stages.get("llm_routing", [])):
        model = (call.get("request") or {}).get("model", "llm")
        lines.append(f'  LLM{i}["llm: {_label(model)}"]')
        lines.append(f"  ID --> LLM{i}")

    lines.append("  classDef dim fill:#eee,stroke:#bbb,color:#888;")
    return "\n".join(lines)


def render_html(trace: dict[str, Any]) -> str:
    """A self-contained HTML explorer (no external deps): the Mermaid source plus
    collapsible per-stage input/output payloads."""
    mermaid = render_mermaid(trace)
    stages = trace.get("stages", {})
    ident = trace.get("analysis_id") or trace.get("run_id") or "run"
    out: list[str] = [
        "<!doctype html><html><head><meta charset='utf-8'>",
        f"<title>Run trace {_html.escape(str(ident))}</title>",
        "<style>body{font:14px/1.5 system-ui,sans-serif;margin:2rem;color:#222}"
        "pre{background:#f6f8fa;padding:1rem;overflow:auto;border-radius:6px}"
        "details{margin:.5rem 0;border:1px solid #ddd;border-radius:6px;padding:.5rem}"
        "summary{cursor:pointer;font-weight:600}.sum{color:#555}</style></head><body>",
        f"<h1>Run trace {_html.escape(str(ident))}</h1>",
        f"<p class='sum'>{_html.escape(json.dumps(trace.get('summary', {})))}</p>",
        "<h2>Flow</h2>",
        "<pre class='mermaid'>" + _html.escape(mermaid) + "</pre>",
        "<p class='sum'>Paste the flow block into a Mermaid renderer, or view the .flow.md on GitHub.</p>",
        "<h2>Stage payloads</h2>",
    ]
    for name, payload in stages.items():
        out.append(f"<details><summary>{_html.escape(name)}</summary>")
        out.append("<pre>" + _html.escape(json.dumps(payload, indent=2, default=str)) + "</pre>")
        out.append("</details>")
    out.append("</body></html>")
    return "".join(out)


def _stem(name: str) -> str:
    for suffix in (".json.gz", ".json"):
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return name


def main(argv: list[str] | None = None) -> int:
    import argparse

    ap = argparse.ArgumentParser(description="Render a run-trace JSON to a flow diagram.")
    ap.add_argument("trace_path", help="path to a trace .json or .json.gz")
    ap.add_argument("--html", action="store_true",
                    help="also write a self-contained .flow.html explorer")
    ap.add_argument("--out-dir", default=None, help="output dir (default: beside the trace)")
    args = ap.parse_args(argv)

    trace = read_trace(args.trace_path)
    src = Path(args.trace_path)
    stem = _stem(src.name)
    out_dir = Path(args.out_dir) if args.out_dir else src.parent
    out_dir.mkdir(parents=True, exist_ok=True)

    md_path = out_dir / f"{stem}.flow.md"
    md_path.write_text("```mermaid\n" + render_mermaid(trace) + "\n```\n", encoding="utf-8")
    written = [md_path]
    if args.html:
        html_path = out_dir / f"{stem}.flow.html"
        html_path.write_text(render_html(trace), encoding="utf-8")
        written.append(html_path)

    for w in written:
        print(str(w))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
