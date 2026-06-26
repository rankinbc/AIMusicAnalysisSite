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
