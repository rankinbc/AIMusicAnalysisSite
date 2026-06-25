from __future__ import annotations

from pathlib import Path

from app.tools.pipeline_inspector import main


def test_catalog_mode_writes_html_without_db(tmp_path, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)  # prove no DB needed
    rc = main(["--catalog", "--out-dir", str(tmp_path)])
    assert rc == 0
    out = Path(tmp_path) / "_catalog.html"
    assert out.exists()
    assert "Pipeline & rule-system catalog" in out.read_text(encoding="utf-8")


def test_validate_map_with_drifting_snapshot_returns_nonzero(tmp_path, monkeypatch):
    # The sparse snapshot is missing declared phase1 keys so the gate trips.
    import json
    snap = Path(tmp_path) / "snap.json"
    snap.write_text(json.dumps({
        "overall_score": 1, "grade": "F", "danceability_score": 0,
        "top_fixes": [], "coach_name": "c", "coach_intro": "i", "coached_fixes": [],
        "phases": [{"phase": 1, "data": {"lufs": -9.0, "true_peak_db": -1.0}}],
    }), encoding="utf-8")
    rc = main(["--validate-map", "--snapshot", str(snap)])
    # phase1 present but map declares more keys than snapshot has → phantom →
    # non-zero. This asserts the gate trips on drift.
    assert rc != 0


def test_unknown_arg_combo_errors(tmp_path):
    rc = main(["--validate-map", "--snapshot", str(tmp_path / "nope.json")])
    assert rc != 0
