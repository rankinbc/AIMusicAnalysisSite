"""Degraded-verdict path helpers (story 1.4 / FR16).

When the gateway raises :class:`LlmBudgetExceeded`, the actors call:

  1. :func:`write_degradation_notice` — stamps a machine-readable JSON blob
     on ``analyses.degradation_notice`` so the BFF + frontend can render
     the "rule-based findings only" banner (AC2 / AC3).
  2. :func:`run_rule_engine_for_analysis` — evaluates the deterministic
     rule engine against the analysis JSON and persists any verdicts it
     produces, so the user gets something actionable even with no LLM.

Both helpers are **idempotent**: a notice is never overwritten (first
failure wins); rule-engine rows are only inserted if none exist yet. This
lets a second specialist actor that trips the same budget exception
no-op safely.

No ``anthropic`` / no ``gateway`` import here — this module sits BELOW
the gateway in the dependency graph so the gateway can stay LLM-only.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from aimusic_shared.verdicts.models import Verdict as VerdictModel

from app.verdict_lib import rule_engine
from app.verdict_lib.flatten_analysis import flatten

logger = logging.getLogger(__name__)


def write_degradation_notice(
    analysis_id: uuid.UUID, *, reason: str, detail: str | None = None,
) -> None:
    """Stamp the degradation notice on ``analyses.degradation_notice``.

    Idempotent — does NOT overwrite an existing notice (first failure wins).
    Best-effort: a DB failure is logged but does not raise (mirrors the
    story 1.3 metering fail-open pattern; user-facing rule-engine verdicts
    are written separately so a bad notice write doesn't blank the report).
    """
    payload: dict[str, Any] = {
        "reason": reason,
        "detail": detail,
        "occurred_at": datetime.now(tz=timezone.utc).isoformat(),
    }
    try:
        # Lazy DB imports: keeps this module importable without DATABASE_URL
        # (unit tests stay env-free) and mirrors the story 1.3 metering pattern.
        from aimusic_shared.models import Analysis  # noqa: PLC0415

        from app.db_sync import SessionFactory  # noqa: PLC0415

        with SessionFactory.begin() as s:
            row = s.get(Analysis, analysis_id)
            if row is None:
                logger.warning("degradation notice: analysis %s not found", analysis_id)
                return
            if row.degradation_notice is not None:
                # First failure wins — don't overwrite.
                return
            row.degradation_notice = payload
    except Exception:
        logger.exception(
            "degradation notice write failed (analysis=%s reason=%s)",
            analysis_id, reason,
        )


def run_rule_engine_for_analysis(analysis_id: uuid.UUID) -> int:
    """Evaluate the two-pass Problem engine (``rule_engine.evaluate_problems``)
    against the analysis and persist the de-suppressed, validated Problem rows.
    Returns the count actually written.

    Idempotent — returns 0 without writing if any rule-engine row already exists
    on this analysis. The guard keys on ``source == "rule_engine"`` (NOT an exact
    ``specialist`` match): the Problem engine sets ``specialist="rule_engine.<slug>"``,
    so the old exact match would never see existing rows and would double-insert.
    """
    try:
        from sqlalchemy import select  # noqa: PLC0415

        from aimusic_shared.models import Analysis, Verdict as VerdictRow  # noqa: PLC0415

        from app.db_sync import SessionFactory  # noqa: PLC0415
        from app.verdict_lib.validator import validate_verdict  # noqa: PLC0415

        with SessionFactory.begin() as s:
            analysis = s.get(Analysis, analysis_id)
            if analysis is None:
                logger.warning("rule engine: analysis %s not found", analysis_id)
                return 0
            existing = s.execute(
                select(VerdictRow.id)
                .where(VerdictRow.analysis_id == analysis_id)
                .where(VerdictRow.source == "rule_engine")
                .limit(1)
            ).first()
            if existing is not None:
                return 0
            raw_final = analysis.final_json
            # Production pipeline writes ``{"phases": [...]}``; ``flatten``
            # pivots that into ``{"phaseN": {...}}`` shape the rule engine
            # reads. Without it every rule's ``_phase(analysis, "phase1")``
            # returns ``{}`` and ZERO verdicts persist (matching the same
            # convention as ``verdict_actor.run_specialist``).
            flattened = flatten(raw_final if isinstance(raw_final, dict) else {})
            flattened.setdefault("track_id", str(analysis.id))
            problems: list[VerdictModel] = rule_engine.evaluate_problems(flattened)
            # Validate each (caps genre-aware severity, recomputes priority_score,
            # rejects unresolvable-evidence rows) before persisting.
            written = 0
            for v in problems:
                result = validate_verdict(v, flattened)
                if not result.ok or result.verdict is None:
                    reason = result.failure.reason if result.failure else "unknown"
                    logger.warning("rule engine: %s failed validation: %s",
                                   v.problem_id or v.headline, reason)
                    continue
                s.add(_to_row(analysis_id, result.verdict))
                written += 1
    except Exception:
        logger.exception("rule engine evaluation failed for analysis=%s", analysis_id)
        return 0

    logger.info("rule engine wrote %d verdicts for analysis=%s", written, analysis_id)
    return written


def _to_row(analysis_id: uuid.UUID, v: VerdictModel) -> Any:
    """Map a pydantic :class:`Verdict` to the SQLAlchemy row.

    Mirrors the shape ``verdict_actor._persist_verdict`` uses, but kept local
    so degraded.py has no upward dep on the actor module.
    """
    from aimusic_shared.models import Verdict as VerdictRow  # noqa: PLC0415

    metric_line = v.evidence[0].label if v.evidence else None
    return VerdictRow(
        id=v.verdict_id,
        analysis_id=analysis_id,
        specialist=v.specialist,
        prompt_version=v.prompt_version,
        model=v.model,
        severity=v.severity,
        category=v.category,
        confidence=v.confidence,
        priority_score=v.priority_score,
        impact="med",
        chart_type=None,
        headline=v.headline[:120],
        summary=v.summary,
        body=v.summary,
        metric_line=metric_line,
        why_it_matters=v.why_it_matters,
        preset_name=None,
        evidence=[e.model_dump() for e in v.evidence],
        fix=(v.fix.model_dump() if v.fix else None),
        sources=v.sources,
        created_at=datetime.now(timezone.utc),
        # IDENTIFY-tier Problem fields — set verbatim from the producer.
        problem_id=v.problem_id,
        kind=v.kind,
        source=v.source,
        data_tier=v.data_tier,
        fixable=v.fixable,
        suspected=v.suspected,
        where=v.where,
        refines=v.refines,
    )
