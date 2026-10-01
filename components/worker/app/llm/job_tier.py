"""Resolve the billing tier an LLM call should be metered under.

Credit economy (PRPs/credit-economy.md 3.8): triage/specialist/coach calls
used to pass no tier, so all spend landed in the FREE lane's ceiling - a few
paying users would trip it and take the coach offline for everyone. The tier
the BFF stamped on the analysis job is the authoritative answer.
"""
from __future__ import annotations

import logging
from typing import Any

from aimusic_shared.models import AnalysisJob

logger = logging.getLogger(__name__)


def tier_for_analysis(session: Any, analysis: Any) -> str | None:
    job_id = getattr(analysis, "job_id", None)
    if job_id is None:
        return None
    try:
        job = session.get(AnalysisJob, job_id)
    except Exception:  # noqa: BLE001 - metering lane must never fail the actor
        logger.warning("tier lookup failed for job %s; using default lane", job_id, exc_info=True)
        return None
    tier = getattr(job, "tier", None) if job is not None else None
    return tier or None
