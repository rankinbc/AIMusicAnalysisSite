from __future__ import annotations

from datetime import datetime, timezone

from app.tools.inspector.build import build_catalog_model, build_trace_model
from app.tools.inspector.loader import RawTrace


def test_catalog_model_lists_rules_and_specialists():
    m = build_catalog_model()
    assert m["mode"] == "catalog"
    assert any(r["name"] == "clipping_count" for r in m["rules"])
    assert "loudness" in m["specialists"]
    assert any(s["key"] == "phase1" for s in m["stages"])


def test_catalog_flags_unmapped_rule_paths_statically():
    # over_compression reads phase1.crest_factor, which no stage declares
    # (Phase 1's stage-map entry emits peak_dbfs + rms, not crest) — a
    # still-open stage-map gap that must be flagged with no analysis.
    m = build_catalog_model()
    unmapped = {g["path"] for g in m["static_gaps"]["unmapped_rule_paths"]}
    assert "phase1.crest_factor" in unmapped


def test_trace_model_marks_fired_rule_and_header():
    raw = RawTrace(
        id="11111111-1111-1111-1111-111111111111",
        job_id="22222222-2222-2222-2222-222222222222",
        song_name="T",
        created_at=datetime(2026, 6, 17, tzinfo=timezone.utc),
        final_json={"overall_score": 42.0, "grade": "F", "phases": [
            {"phase": 1, "data": {"clipping_detected": True, "clipped_sample_count": 9}},
        ]},
        routing_plan={"specialists_to_run": [{"name": "loudness"}], "skip": [], "rationale": "x"},
        verdicts=[],
    )
    m = build_trace_model(raw)
    assert m["mode"] == "trace"
    assert m["header"]["grade"] == "F"
    fired = {r["name"]: r["fired"] for r in m["rules"]}
    assert fired["clipping_count"] is True
    assert m["specialist_status"]["loudness"] == "ran"
    assert m["specialist_status"]["dynamics"] == "not_selected"


def test_trace_model_diagnoses_misnamed_rule_as_bug():
    # phase1 ran and is populated, but over_compression reads
    # phase1.crest_factor / phase1.loudness_range_lu, both absent from this
    # snapshot — that's a bug diagnosis, not an input-gated idle.
    raw = RawTrace(
        id="11111111-1111-1111-1111-111111111111",
        job_id="22222222-2222-2222-2222-222222222222",
        song_name="T",
        created_at=None,
        final_json={"overall_score": 1.0, "grade": "F", "phases": [
            {"phase": 1, "data": {"lufs": -13.0, "true_peak_db": -2.0}},
        ]},
        routing_plan=None,
        verdicts=[],
    )
    m = build_trace_model(raw)
    dr = next(r for r in m["rules"] if r["name"] == "over_compression")
    assert dr["diagnosis"] == "bug"
    assert m["inputs"]["music"] is True
    assert m["inputs"]["reference"] is False
    assert m["rule_diagnosis_summary"]["bug"] >= 1
