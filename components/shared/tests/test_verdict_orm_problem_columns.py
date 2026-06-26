"""The Verdict ORM mirrors the EF `verdicts` table — it must carry the 8
IDENTIFY-tier Problem columns (EF migration AddVerdictProblemFields), or the
worker can't persist them.
"""
from __future__ import annotations

from aimusic_shared.models import Verdict


def test_verdict_orm_has_problem_columns():
    cols = set(Verdict.__table__.columns.keys())
    assert {"problem_id", "kind", "source", "data_tier",
            "fixable", "suspected", "where", "refines"} <= cols


def test_verdict_orm_problem_defaults_present():
    t = Verdict.__table__.c
    # Non-null columns must carry a default so existing rows + bare inserts are safe.
    for name in ("kind", "source", "data_tier", "fixable", "suspected"):
        col = t[name]
        assert col.default is not None or col.server_default is not None, name
    # Nullable columns
    for name in ("problem_id", "where", "refines"):
        assert t[name].nullable is True, name
