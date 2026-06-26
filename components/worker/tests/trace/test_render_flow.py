"""Phase 7: the flow-diagram generator turns a trace JSON into a Mermaid
flowchart (+ a self-contained HTML explorer)."""
from __future__ import annotations

from app.trace.render_flow import main, render_html, render_mermaid
from app.trace.run_trace import build_run_trace


def _final_json():
    return {
        "grade": "F",
        "phases": [
            {"phase": 1, "name": "loudness", "data": {
                "clipping_detected": True, "clipped_sample_count": 1234,
                "true_peak_db": -1.5, "lufs": -8.0}},
            {"phase": 2, "name": "genre", "data": {"genre": "techno"}},
        ],
    }


def _trace():
    return build_run_trace(run_id="r", analysis_id="a1", final_json=_final_json()).to_dict()


def test_render_mermaid_has_core_nodes_and_routes():
    mer = render_mermaid(_trace())
    assert mer.startswith("flowchart TD")
    assert "IDENTIFY" in mer
    assert "clipping" in mer            # a fired problem node
    assert "solver:" in mer            # clipping routes to a solver
    assert "Fix Rack" in mer


def test_render_mermaid_handles_empty_trace():
    # No crash on a minimal/garbage trace.
    mer = render_mermaid({"stages": {}, "summary": {}})
    assert mer.startswith("flowchart TD")
    assert "IDENTIFY" in mer


def test_render_html_is_self_contained():
    h = render_html(_trace())
    assert "<html" in h and "</html>" in h
    assert "<script" not in h.lower()       # no external/JS deps
    assert "IDENTIFY" in h                    # embeds the flow
    assert "Stage payloads" in h             # collapsible payload sections


def test_main_writes_flow_md(tmp_path):
    rt = build_run_trace(run_id="r", analysis_id="a1", final_json=_final_json())
    trace_path = rt.write(tmp_path, gzip_json=False)
    rc = main([str(trace_path)])
    assert rc == 0
    md = tmp_path / "a1.flow.md"
    assert md.exists()
    text = md.read_text(encoding="utf-8")
    assert text.startswith("```mermaid")
    assert "flowchart TD" in text


def test_main_html_flag_writes_both(tmp_path):
    rt = build_run_trace(run_id="r", analysis_id="a2", final_json=_final_json())
    trace_path = rt.write(tmp_path, gzip_json=True)   # .json.gz round-trip
    rc = main([str(trace_path), "--html"])
    assert rc == 0
    assert (tmp_path / "a2.flow.md").exists()
    assert (tmp_path / "a2.flow.html").exists()
