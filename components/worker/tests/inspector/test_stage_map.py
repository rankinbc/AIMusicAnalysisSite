from __future__ import annotations

from app.tools.inspector.stage_map import (
    STAGE_MAP,
    declared_output_paths,
    diff_against_final_json,
    final_json_output_paths,
    stage_for_path,
)


def test_map_covers_all_pipeline_stages():
    keys = {s.key for s in STAGE_MAP}
    for n in range(1, 10):
        assert f"phase{n}" in keys
    assert {"rollups", "rule_engine", "triage", "specialists", "validation", "ranking"} <= keys


def test_declared_outputs_include_known_phase1_metrics():
    paths = declared_output_paths()
    assert "phase1.true_peak_db" in paths
    assert "phase1.lufs" in paths
    assert "phase2.genre" in paths
    assert "overall_score" in paths


def test_stage_for_path_resolves_producer():
    assert stage_for_path("phase1.true_peak_db") == "phase1"
    assert stage_for_path("nonexistent.field") is None


def test_diff_does_not_flag_verdict_pipeline_outputs():
    """Verdict-pipeline outputs must never appear in the phantom list.

    These keys (rule_verdicts, ranked_verdicts, routing_plan.*, specialist_verdicts,
    validated_verdicts) live in the verdicts table / routing_plan column, NOT in
    final_json. --validate-map must not report them as phantom when they are absent
    from a final_json snapshot.
    """
    # A minimal but valid final_json with one present phase1 entry.
    final_json = {
        "overall_score": 80.0,
        "grade": "B",
        "danceability_score": 70,
        "top_fixes": [],
        "coach_name": "Coach",
        "coach_intro": "x",
        "coached_fixes": [],
        "file_path": "uploads/track.wav",
        "phases": [
            {"phase": 1, "name": "Universal", "data": {
                "lufs": -9.0, "true_peak_db": -1.0,
            }},
        ],
    }
    _, phantom = diff_against_final_json(final_json)
    verdict_pipeline_keys = {
        "rule_verdicts",
        "ranked_verdicts",
        "routing_plan.specialists_to_run",
        "specialist_verdicts",
        "validated_verdicts",
    }
    flagged = verdict_pipeline_keys & set(phantom)
    assert not flagged, f"Verdict-pipeline outputs falsely flagged as phantom: {flagged}"


def test_diff_flags_stale_and_phantom():
    final_json = {
        "overall_score": 42.0,
        "grade": "F",
        "danceability_score": 10,
        "top_fixes": [],
        "coach_name": "Coach",
        "coach_intro": "x",
        "coached_fixes": [],
        "phases": [
            {"phase": 1, "name": "Universal", "data": {
                "true_peak_db": -0.2, "lufs": -9.0, "brand_new_metric": 1.0,
            }},
        ],
    }
    stale_missing, phantom = diff_against_final_json(final_json)
    # New, undeclared pipeline output → stale/missing (map needs updating).
    assert "phase1.brand_new_metric" in stale_missing
    # phase1 IS present but the map declares more phase1 keys than the snapshot
    # has → those are phantom; a declared key the snapshot lacks shows here.
    assert "phase1.clipping_detected" in phantom
    # phase2..9 are absent from the snapshot → their declared outputs are NOT
    # phantom (optional/skipped phases must not false-flag).
    assert all(not p.startswith("phase2.") for p in phantom)
