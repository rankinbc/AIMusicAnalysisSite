from __future__ import annotations

from app.tools.inspector.build import build_catalog_model
from app.tools.inspector.render import render_html


def test_render_catalog_is_self_contained_html():
    html_out = render_html(build_catalog_model())
    assert html_out.lstrip().startswith("<!DOCTYPE html>")
    assert "Pipeline & rule-system catalog" in html_out
    assert "clipping_detected" in html_out
    assert "http://" not in html_out and "https://" not in html_out  # no external assets


def test_trace_render_includes_disclaimer_banner():
    model = build_catalog_model()
    model["mode"] = "trace"
    model["header"] = {"id": "abc", "job_id": "j", "song_name": "S",
                       "created_at": None, "overall_score": 42.0, "grade": "F"}
    model["routing_plan"] = None
    model["specialist_status"] = {}
    model["verdicts"] = []
    for r in model["rules"]:
        r.setdefault("fired", False)
        r.setdefault("error", None)
        r.setdefault("path_resolution", {})
    out = render_html(model)
    assert "Recomputed with current code" in out


def test_render_escapes_dynamic_text():
    model = build_catalog_model()
    model["stages"].append({"key": "x", "title": "<script>alert(1)</script>",
                            "narration": "n", "inputs": [], "outputs": []})
    out = render_html(model)
    assert "<script>alert(1)</script>" not in out
    assert "&lt;script&gt;" in out
