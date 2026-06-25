"""Unit tests for the schema-contract resolver, extractors, and ratchet diffs."""
from __future__ import annotations

import pytest

from app.verdict_lib.schema_contract import (
    diff_new,
    diff_stale,
    fixture_paths,
    load_contract,
    path_resolves,
    prompt_paths,
)

# A tiny synthetic contract — independent of the real manifest.
_C = {
    "bare_top_level_allowed": ["track_id"],
    "dynamic_prefixes": ["phase6.gaps", "phase4.stems.per_stem"],
    "leaf_paths": [
        "phase1.lufs",
        "phase1.bands.sub_bass",
        "phase4.clashes[].severity",
        "phase8.tracks[].name",
        "overall_score",
    ],
}


@pytest.mark.parametrize("path,expected", [
    ("phase1.lufs", True),               # exact leaf
    ("phase1.integrated_lufs", False),   # the canonical drift
    ("phase1.bands", True),              # ancestor of a leaf (container read)
    ("phase1.bands.sub_bass", True),     # nested exact leaf
    ("phase4.clashes[0].severity", True),  # array index normalizes to []
    ("phase4.clashes", True),            # ancestor of an array leaf
    ("phase8.tracks[2].name", True),     # array index deep
    ("track_id", True),                  # runtime-injected bare key
    ("genre_hint", False),               # NOT injected → drift
    ("phase6.gaps.bpm.in_range", True),  # under a dynamic prefix
    ("phase6.gaps", True),               # the dynamic prefix itself
    ("phase4.stems.per_stem.kick.peak_db", True),  # dynamic, deep
    ("overall_score", True),
    ("phase1.bogus_field", False),       # injected unresolved path
    ("", False),
])
def test_path_resolves(path, expected):
    assert path_resolves(path, _C) is expected


def test_prompt_paths_extracts_namespaced_dotted_paths():
    md = (
        "Read `audio_analysis.loudness.integrated_lufs` and phase1.lufs.\n"
        "The `stem_analysis.clashes` matter. Version 1.0.0 is not a path.\n"
        "Plain prose about loudness and dynamics has no dotted path."
    )
    got = prompt_paths(md)
    assert "audio_analysis.loudness.integrated_lufs" in got
    assert "phase1.lufs" in got
    assert "stem_analysis.clashes" in got
    assert "1.0.0" not in got
    assert not any(p.startswith("Version") for p in got)


def test_fixture_paths_walks_to_dotted_leaves():
    obj = {"phase1": {"lufs": -9.0, "bands": {"sub_bass": 1.0}},
           "genre_hint": "trance",
           "phase4": {"clashes": [{"severity": "high"}]}}
    got = fixture_paths(obj)
    assert got == {"phase1.lufs", "phase1.bands.sub_bass", "genre_hint",
                   "phase4.clashes[].severity"}


def test_fixture_paths_flattens_raw_phases_list():
    obj = {"grade": "F", "phases": [{"phase": 1, "data": {"lufs": -9.0}}]}
    assert fixture_paths(obj) == {"grade", "phase1.lufs"}


# ── ratchet semantics (Task 5) ──────────────────────────────────────────────

def test_injected_unresolved_path_is_flagged_as_new():
    baseline = {"rules": ["r::phase1.crest_factor"], "prompts": [], "fixtures": []}
    current = {"rules": ["r::phase1.crest_factor", "r::phase1.bogus_field"],
               "prompts": [], "fixtures": []}
    new = diff_new(current, baseline)
    assert new["rules"] == ["r::phase1.bogus_field"]
    assert sum(len(v) for v in new.values()) == 1


def test_fixed_offender_must_leave_baseline():
    baseline = {"rules": ["r::phase1.crest_factor", "r::phase3.low_mid_energy"],
                "prompts": [], "fixtures": []}
    current = {"rules": ["r::phase1.crest_factor"], "prompts": [], "fixtures": []}
    stale = diff_stale(current, baseline)
    assert stale["rules"] == ["r::phase3.low_mid_energy"]


def test_real_contract_loads_and_has_core_leaves():
    c = load_contract()
    assert "phase1.lufs" in c["leaf_paths"]
    assert "phase1.integrated_lufs" not in c["leaf_paths"]
    assert path_resolves("phase1.lufs", c)
    assert not path_resolves("phase1.crest_factor", c)
