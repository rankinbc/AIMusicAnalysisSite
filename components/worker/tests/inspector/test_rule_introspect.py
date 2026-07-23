from __future__ import annotations

from app.tools.inspector.rule_introspect import (
    read_paths_for_rule,
    resolve_path,
    rule_catalog,
    run_rule,
)
from app.verdict_lib import rule_engine


def _rule(name: str):
    return next(fn for slug, fn in rule_engine._SINGLES if slug == name)


def test_read_paths_extracts_phase_get_calls():
    paths = read_paths_for_rule(_rule("clipping_count"))
    assert "phase1.clipping_detected" in paths
    assert "phase1.clipped_sample_count" in paths


def test_read_paths_extracts_evidence_metric_literals():
    # mud_buildup binds `bands` via a chained expression the assignment tracker
    # can't follow — the literal Evidence(metric=...) is what catalogs it.
    paths = read_paths_for_rule(_rule("mud_buildup"))
    assert "phase1.bands.low_mid" in paths


def test_resolve_path_states():
    flat = {"phase1": {"true_peak_db": -0.3, "lufs": None}}
    assert resolve_path(flat, "phase1.true_peak_db") == "present"
    assert resolve_path(flat, "phase1.lufs") == "null"
    assert resolve_path(flat, "phase1.missing") == "missing"
    assert resolve_path(flat, "phase2.genre") == "missing"


def test_run_rule_fires_on_clipping():
    flat = {"phase1": {"clipping_detected": True, "clipped_sample_count": 12}}
    out = run_rule(_rule("clipping_count"), flat)
    assert out["fired"] is True
    assert out["verdict"] is not None
    assert out["error"] is None


def test_run_rule_does_not_fire_when_clean():
    out = run_rule(_rule("clipping_count"), {"phase1": {"clipping_detected": False}})
    assert out["fired"] is False
    assert out["verdict"] is None


def test_rule_catalog_lists_every_registered_rule():
    cat = rule_catalog()
    names = {e["name"] for e in cat}
    assert "clipping_count" in names
    assert "tempo_octave_error" in names
    assert len(cat) == len(rule_engine._SINGLES)
    assert all("read_paths" in e for e in cat)
