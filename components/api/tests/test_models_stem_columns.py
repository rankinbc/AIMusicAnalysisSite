"""Verify the stem-related ORM additions are present on the canonical models."""
from sqlalchemy import inspect

from aimusic_shared.models import AnalysisResult, JobStatus, UploadJob


def test_upload_job_has_stem_paths_columns():
    cols = {c.name for c in inspect(UploadJob).columns}
    assert "stem_paths_raw" in cols
    assert "stem_paths" in cols


def test_analysis_result_has_stem_metrics():
    cols = {c.name for c in inspect(AnalysisResult).columns}
    assert "stem_metrics" in cols


def test_job_status_enum_has_awaiting_stem_mapping():
    assert "AWAITING_STEM_MAPPING" in {s.name for s in JobStatus}
