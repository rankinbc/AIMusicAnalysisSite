"""Genre-config loader — resolves phase2.genre → profile, reads profile numbers
by dotted path, platform targets, master_context, and per-rule bindings.
Config files live in app/verdict_lib/config/.
"""
from __future__ import annotations

from app.verdict_lib import genre_config as G


def test_genre_map_routes_techno_to_itself_rest_to_modern_trance():
    assert G.resolve_genre("techno") == "techno"
    assert G.resolve_genre("trance") == "modern_trance"
    assert G.resolve_genre("house") == "modern_trance"
    assert G.resolve_genre("dnb") == "modern_trance"
    assert G.resolve_genre(None) == "modern_trance"        # genre_map.default
    assert G.resolve_genre("made_up") == "modern_trance"


def test_ppath_reads_genre_numbers():
    assert G.ppath("techno", "loudness.club.lufs_target") == -6.5
    assert G.ppath("trance", "loudness.streaming.lufs_target") == -14.0
    assert G.ppath("techno", "dynamics.crest_db.warn_below") == 4.0
    assert G.ppath("trance", "loudness.streaming.lufs_tolerance") == 1.5
    assert G.ppath("techno", "missing.path", default=None) is None


def test_platform_targets_and_master_context():
    assert G.platform("hot_master_threshold_lufs") == -14.0
    assert G.platform("hot_master_true_peak_dbtp") == -2.0
    assert G.platform("recommended_streaming_true_peak_dbtp") == -1.0
    assert G.master_context() == "streaming"


def test_binding_returns_predicate_spec():
    assert G.binding("A2_loudness_vs_target")["reads_field"] == "phase1.lufs"


# ── Phase 1: a missing/malformed config degrades to a minimal fallback ───────

def test_malformed_config_falls_back_to_minimal(monkeypatch, tmp_path):
    # Point the loader at an empty dir (no json files) and clear the caches:
    # missing config must degrade to the minimal fallback, not raise on every analysis.
    monkeypatch.setattr(G, "_DIR", tmp_path)
    G._profiles.cache_clear()
    G._bindings.cache_clear()
    try:
        assert G.resolve_genre("trance") == "_fallback"
        # ppath returns the rule's own default when the profile is empty
        assert G.ppath("trance", "loudness.club.lufs_target", -14.0) == -14.0
        assert G.master_context() == "streaming"
        assert G.platform("anything", default=0) == 0
    finally:
        # Drop the fallback-cached values so other tests re-read the real config.
        G._profiles.cache_clear()
        G._bindings.cache_clear()
