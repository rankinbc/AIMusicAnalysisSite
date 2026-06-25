"""Render an inspector view model into a single self-contained HTML page."""
from __future__ import annotations

import html
import json
from typing import Any

_CSS = """
body{font:14px/1.5 system-ui,sans-serif;margin:0;background:#0d1117;color:#e6edf3}
header{padding:16px 24px;background:#161b22;border-bottom:1px solid #30363d}
h1{font-size:18px;margin:0 0 4px}
section{padding:16px 24px;border-bottom:1px solid #21262d}
h2{font-size:15px;color:#7ee787;margin:0 0 8px}
.narration{color:#9da7b3;margin:0 0 10px;max-width:80ch}
.card{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:10px 12px;margin:6px 0}
.badge{display:inline-block;padding:1px 7px;border-radius:10px;font-size:12px;margin-left:6px}
.fired{background:#1f6f3f;color:#d6ffe0}.idle{background:#30363d;color:#9da7b3}
.missing{background:#7d1f1f;color:#ffd6d6}.null{background:#7d6a1f;color:#fff4d6}
.present{background:#1f4f7d;color:#d6ecff}
.warn{background:#3d2a00;border:1px solid #9e6a00;color:#ffd98a;padding:10px 12px;border-radius:6px;margin:8px 0}
table{border-collapse:collapse;width:100%;font-size:13px}
td,th{border:1px solid #30363d;padding:4px 8px;text-align:left;vertical-align:top}
code,pre{font-family:ui-monospace,monospace}
pre{white-space:pre-wrap;background:#0d1117;padding:8px;border-radius:6px;border:1px solid #30363d}
summary{cursor:pointer;color:#58a6ff}
"""

_DISCLAIMER = (
    "⚠️ Recomputed with current code. Deterministic stages (rule engine, "
    "validation, severity scoring) are re-run against the stored final_json "
    "using the CURRENT module versions, which may differ from the code that "
    "produced this analysis. LLM stages (triage, specialists) are shown from "
    "persisted data, not re-run. Treat stored-vs-recomputed drift as a signal."
)


def _e(x: Any) -> str:
    return html.escape("" if x is None else str(x))


def _json_block(obj: Any) -> str:
    return f"<pre>{_e(json.dumps(obj, indent=2, default=str))}</pre>"


def _stage_card(s: dict[str, Any]) -> str:
    io = ""
    if s["inputs"] or s["outputs"]:
        io = (f"<div><b>in:</b> <code>{_e(', '.join(s['inputs']))}</code><br>"
              f"<b>out:</b> <code>{_e(', '.join(s['outputs']))}</code></div>")
    return (f"<div class='card'><b>{_e(s['title'])}</b>"
            f"<p class='narration'>{_e(s['narration'])}</p>{io}</div>")


def _rule_card(r: dict[str, Any], trace: bool) -> str:
    head = f"<b>{_e(r['name'])}</b>"
    if trace:
        status = 'fired' if r.get('fired') else 'idle'
        head += (f"<span class='badge {_e(status)}'>"
                 f"{_e('FIRED' if r.get('fired') else 'idle')}</span>")
    rows = ""
    res = r.get("path_resolution", {}) if trace else {}
    for p in r["read_paths"]:
        producer = r["producers"].get(p)
        prod_txt = _e(producer) if producer else "<span class='badge missing'>unmapped</span>"
        state = res.get(p)
        state_txt = f"<span class='badge {_e(state)}'>{_e(state)}</span>" if state else ""
        rows += f"<tr><td><code>{_e(p)}</code></td><td>{prod_txt}</td><td>{state_txt}</td></tr>"
    table = (f"<table><tr><th>reads</th><th>produced by</th><th>value</th></tr>{rows}</table>"
             if r["read_paths"] else "<i>no datapoints extracted</i>")
    doc = f"<p class='narration'>{_e(r['doc'])}</p>" if r.get("doc") else ""
    return f"<div class='card'>{head}{doc}{table}</div>"


def _section(title: str, body: str) -> str:
    return f"<section><h2>{_e(title)}</h2>{body}</section>"


def render_html(model: dict[str, Any]) -> str:
    trace = model.get("mode") == "trace"
    parts: list[str] = []

    if trace:
        h = model.get("header", {})
        title = f"Analysis {_e(h.get('id'))} — {_e(h.get('song_name'))}"
        sub = (f"job {_e(h.get('job_id'))} · {_e(h.get('created_at'))} · "
               f"score {_e(h.get('overall_score'))} · grade {_e(h.get('grade'))}")
        banner = f"<div class='warn'>{_e(_DISCLAIMER)}</div>"
    else:
        title = "Pipeline & rule-system catalog — no analysis"
        sub = "static structure of every stage, rule, and specialist"
        banner = ""

    parts.append(f"<header><h1>{title}</h1><div class='narration'>{sub}</div>{banner}</header>")

    parts.append(_section("Pipeline stages", "".join(_stage_card(s) for s in model["stages"])))
    parts.append(_section("Rule engine", "".join(_rule_card(r, trace) for r in model["rules"])))

    spec_body = ", ".join(
        f"{_e(slug)}"
        + (f" <span class='badge {_e('fired' if model['specialist_status'].get(slug)=='ran' else 'idle')}'>"
           f"{_e(model['specialist_status'].get(slug))}</span>" if trace else "")
        for slug in model["specialists"]
    )
    parts.append(_section("Specialists", f"<div class='card'>{spec_body}</div>"))

    if trace:
        parts.append(_section("Triage routing plan",
                              _json_block(model.get("routing_plan")) if model.get("routing_plan")
                              else "<i>no LLM stage ran (routing_plan is null)</i>"))
        parts.append(_section("Final verdicts", _json_block(model.get("verdicts"))))

    dc_rows = "".join(
        f"<tr><td><code>{_e(d['datapoint'])}</code></td><td>{_e(d['producer'])}</td>"
        f"<td>{_e(', '.join(d['consumers']) or '—')}</td></tr>"
        for d in model["datapoint_consumers"]
    )
    parts.append(_section("Datapoint → consumers",
                          f"<table><tr><th>datapoint</th><th>producer</th><th>consumed by</th></tr>{dc_rows}</table>"))

    gaps = model["static_gaps"]["unmapped_rule_paths"]
    gap_body = ("".join(f"<div class='card'><code>{_e(g['path'])}</code> read by "
                        f"<b>{_e(g['rule'])}</b> — no stage emits this; rule can't fire.</div>"
                        for g in gaps)
                if gaps else "<i>no unmapped rule read-paths 🎉</i>")
    parts.append(_section("System audit — gaps", gap_body))

    return (f"<!DOCTYPE html><html><head><meta charset='utf-8'>"
            f"<title>{title}</title><style>{_CSS}</style></head>"
            f"<body>{''.join(parts)}</body></html>")
