"""The Analysis ORM mirrors the EF `analyses` table — it must carry the 4
version-stamp columns (EF migration AddAnalysisVersionStamps, v3 closeout
2026-07-23), or the worker can't persist provenance stamps.
"""
from __future__ import annotations

from sqlalchemy import String

from aimusic_shared.models import Analysis


def test_analysis_orm_has_version_stamp_columns():
    cols = set(Analysis.__table__.columns.keys())
    assert {"pipeline_version", "rule_engine_version",
            "validator_version", "prompt_set_version"} <= cols


def test_analysis_orm_version_stamps_nullable():
    t = Analysis.__table__.c
    # All 4 are nullable — historical rows predate the stamps.
    for name in ("pipeline_version", "rule_engine_version",
                 "validator_version", "prompt_set_version"):
        assert t[name].nullable is True, name


def test_analysis_orm_version_stamp_lengths_match_ef():
    t = Analysis.__table__.c
    expected = {
        "pipeline_version": 40,
        "rule_engine_version": 60,
        "validator_version": 60,
        "prompt_set_version": 2000,
    }
    for name, length in expected.items():
        col_type = t[name].type
        assert isinstance(col_type, String), name
        assert col_type.length == length, name
