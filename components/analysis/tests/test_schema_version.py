"""Pipeline output carries an analysis_schema_version stamp so downstream tooling
(rule engine, recompute jobs) knows which lifted fields to expect.
"""
from __future__ import annotations

from audio_analysis import ANALYSIS_SCHEMA_VERSION
from audio_analysis.pipeline import finalize_result


def test_schema_version_is_a_nonempty_string():
    assert isinstance(ANALYSIS_SCHEMA_VERSION, str)
    assert ANALYSIS_SCHEMA_VERSION


def test_finalize_result_stamps_schema_version():
    # finalize_result derives the rollups with no audio; the stamp rides along.
    result = finalize_result({}, [], "track.wav")
    assert result["analysis_schema_version"] == ANALYSIS_SCHEMA_VERSION
