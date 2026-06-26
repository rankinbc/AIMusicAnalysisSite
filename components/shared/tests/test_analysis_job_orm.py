"""The worker reads the billing tier off the analysis job (stamped by the BFF at
dispatch, story 2.4) to gate the LLM-identifier stage, so the SQLAlchemy model
must map the ``tier`` column that already exists in the EF-owned schema."""
from __future__ import annotations

from aimusic_shared.models import AnalysisJob


def test_analysis_job_has_tier_column():
    cols = set(AnalysisJob.__table__.columns.keys())
    assert "tier" in cols  # mirrors EF AnalysisJob.Tier


def test_analysis_job_tier_is_nullable_string16():
    c = AnalysisJob.__table__.c.tier
    assert c.nullable is True
    assert c.type.length == 16
