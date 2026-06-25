"""Read-only DB loader for the inspector.

The SQLAlchemy ``sessionmaker`` is injected so this module never imports
``app.db_sync`` (which binds an engine at import and needs DATABASE_URL). The
CLI passes ``app.db_sync.SessionFactory`` lazily; tests pass a sqlite one.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import select

from aimusic_shared.models import Analysis, Verdict


@dataclass
class RawTrace:
    id: str
    job_id: str
    song_name: str | None
    created_at: datetime | None
    final_json: dict[str, Any]
    routing_plan: dict[str, Any] | None
    verdicts: list[dict[str, Any]]


# Hand-maintained subset of aimusic_shared.models.Verdict columns; update here if those change.
_VERDICT_COLS = (
    "id", "specialist", "prompt_version", "model", "severity", "category",
    "confidence", "priority_score", "headline", "summary", "metric_line",
    "why_it_matters", "evidence", "fix", "sources",
)


def resolve_analysis_id(session_factory, prefix: str) -> str:
    # Fetch ids and match the prefix in Python so the logic is identical on
    # sqlite (tests) and Postgres (prod) without dialect-specific text casts.
    # Acceptable for a dev tool; the table is small in dev/debug use.
    prefix = prefix.strip()
    with session_factory() as s:
        rows = s.execute(select(Analysis.id)).scalars().all()
    matches = [str(r) for r in rows if str(r).startswith(prefix)]
    if len(matches) == 1:
        return matches[0]
    raise LookupError(
        f"analysis id prefix {prefix!r} matched {len(matches)} rows (need exactly 1)"
    )


def load_trace(session_factory, analysis_id: str) -> RawTrace:
    aid = uuid.UUID(analysis_id)
    with session_factory() as s:
        a = s.get(Analysis, aid)
        if a is None:
            raise LookupError(f"analysis {analysis_id} not found")
        vrows = s.execute(
            select(Verdict).where(Verdict.analysis_id == aid)
        ).scalars().all()
        verdicts = [{c: getattr(v, c) for c in _VERDICT_COLS} for v in vrows]
        return RawTrace(
            id=str(a.id),
            job_id=str(a.job_id),
            song_name=a.song_name,
            created_at=a.created_at,
            final_json=a.final_json if isinstance(a.final_json, dict) else {},
            routing_plan=a.routing_plan if isinstance(a.routing_plan, dict) else None,
            verdicts=verdicts,
        )
