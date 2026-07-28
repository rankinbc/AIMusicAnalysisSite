"""Dramatiq actor: run one specialist against one analysis.

Wire format (3 string args, matches the BFF's DramatiqJobQueue envelope):

    run_specialist(analysis_id: str, slug: str, user_id: str)

Lifecycle:

  A. Load Analysis + flatten ``final_json``.
  B. Load specialist prompt.
  C. Call claude CLI synchronously (no DB tx held).
  D. Parse, hydrate, validate verdicts.
  E. Persist Verdict rows (one or more).

On any exception in B–D we persist a single "fail-marker" Verdict row with
``severity='minor'`` + ``headline='Specialist failed'`` so the frontend can
render the tile in a failure state. We do NOT retry on failure (max_retries=1
is set but most failures are deterministic).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

import dramatiq

from aimusic_shared.models import Analysis
from aimusic_shared.verdicts.models import Verdict as VerdictModel
from aimusic_shared.verdicts.scoring import compute_priority_score
from aimusic_shared.verdicts.ulid_helpers import new_fix_id, new_verdict_id

from . import obs
from .db_sync import SessionFactory
from .llm import gateway
from .llm.gateway import LlmBudgetExceeded, LlmError
from .verdict_lib.degraded import (
    run_rule_engine_for_analysis,
    write_degradation_notice,
)
from .verdict_lib.dsp_normalize import normalize_dsp_op
from .verdict_lib.flatten_analysis import flatten
from .verdict_lib.input_grounding import build_specialist_user_message
from .verdict_lib.json_extraction import extract_json_object
from .verdict_lib.prompt_loader import load_prompt, load_prompt_model
from .verdict_lib.validator import validate_verdict

# Verdict ORM row (separate module-level reference so we don't shadow the
# pydantic VerdictModel).
try:
    from aimusic_shared.models import Verdict as VerdictRow  # type: ignore[no-redef]
except ImportError as e:  # pragma: no cover — should never fire post-shared init.
    raise ImportError("aimusic_shared.models.Verdict missing — re-run pip install -e components/shared") from e

logger = logging.getLogger(__name__)

RETRY_SUFFIX = (
    "\n\n[SYSTEM] Your previous response was not valid JSON. "
    "Respond with ONLY the JSON object — no prose, no code fences."
)


def _hydrate(raw: dict[str, Any], *, track_id: str, slug: str,
             prompt_version: str, model: str) -> VerdictModel:
    body = dict(raw)
    body.setdefault("verdict_id", new_verdict_id())
    fix = body.get("fix")
    if isinstance(fix, dict):
        fix = dict(fix)
        chain = fix.get("dsp_chain")
        if isinstance(chain, list):
            fix["dsp_chain"] = [normalize_dsp_op(op) for op in chain]
        if not fix.get("fix_id"):
            fix["fix_id"] = new_fix_id()
        body["fix"] = fix
    body["track_id"] = track_id
    body["specialist"] = slug
    body["prompt_version"] = prompt_version
    body["model"] = model
    body.setdefault("priority_score", 0)  # validator recomputes
    body.setdefault("sources", [slug])
    body.setdefault("related_verdict_ids", [])
    body.setdefault("user_state", {})
    body.setdefault("created_at", datetime.now(tz=timezone.utc).isoformat())
    return VerdictModel(**body)


def _persist_fail_marker(analysis_id: uuid.UUID, slug: str, error: str) -> None:
    """Insert a single fail-marker Verdict row. Frontend recognizes it by
    ``headline == "Specialist failed"`` and renders the tile in failure state.
    """
    error_text = (error or "")[:2000]
    # Use moderate-severity priority so the fail marker doesn't dominate the
    # priority-sorted list — it's a UX hint, not a finding.
    priority = compute_priority_score("minor", "overall", "full_track")
    row = VerdictRow(
        id=new_verdict_id(),
        analysis_id=analysis_id,
        specialist=slug,
        prompt_version=f"{slug}@error",
        model="claude-cli",
        severity="minor",
        category="overall",
        confidence=0.5,
        priority_score=priority,
        impact="low",
        chart_type=None,
        headline="Specialist failed",
        summary=error_text[:400] or None,
        body=error_text or None,
        metric_line=None,
        why_it_matters=None,
        preset_name=None,
        evidence=[],
        fix=None,
        sources=[slug],
        created_at=datetime.now(timezone.utc),
    )
    try:
        with SessionFactory.begin() as s:
            s.add(row)
    except Exception:
        logger.exception("could not persist fail-marker for slug=%s", slug)


def _persist_verdict(analysis_id: uuid.UUID, v: VerdictModel) -> None:
    metric_line = v.evidence[0].label if v.evidence else None
    row = VerdictRow(
        id=v.verdict_id,
        analysis_id=analysis_id,
        specialist=v.specialist,
        prompt_version=v.prompt_version,
        model=v.model,
        severity=v.severity,
        category=v.category,
        confidence=v.confidence,
        priority_score=v.priority_score,
        impact="med",  # locked COACH_FINDINGS shape lands in a later slice.
        chart_type=None,
        headline=v.headline[:120],
        summary=v.summary,
        body=v.summary,  # slice 2.5: body mirrors summary until prompts emit body separately.
        metric_line=metric_line,
        why_it_matters=v.why_it_matters,
        preset_name=None,
        evidence=[e.model_dump() for e in v.evidence],
        fix=(v.fix.model_dump() if v.fix else None),
        sources=v.sources,
        created_at=datetime.now(timezone.utc),
        # IDENTIFY-tier Problem fields — set verbatim from the producer (the
        # composite-refiner sets source="llm_identifier"/refines for LLM output).
        problem_id=v.problem_id,
        kind=v.kind,
        source=v.source,
        data_tier=v.data_tier,
        fixable=v.fixable,
        suspected=v.suspected,
        where=v.where,
        refines=v.refines,
        # Priority-score breakdown (results v4) — null on legacy producers.
        priority_base=v.priority_base,
        priority_category_weight=v.priority_category_weight,
        priority_scope_multiplier=v.priority_scope_multiplier,
        scope=v.scope,
    )
    with SessionFactory.begin() as s:
        s.add(row)


@dramatiq.actor(
    actor_name="run_specialist",
    queue_name="analysis-paid",  # story 2.5: interactive LLM work → W1
    max_retries=1,
    time_limit=180_000,  # 3 minutes
)
def run_specialist(analysis_id: str, slug: str, user_id: str) -> None:
    """See module docstring."""
    aid = uuid.UUID(analysis_id)
    obs.set_correlation(analysis_id)
    logger.info("run_specialist start analysis=%s slug=%s", analysis_id, slug)

    # ── Phase A: load analysis ─────────────────────────────────────────────
    try:
        with SessionFactory.begin() as s:
            analysis = s.get(Analysis, aid)
            if analysis is None:
                _persist_fail_marker(aid, slug, f"analysis {analysis_id} not found")
                return
            # `final_json` is JSONB — already a dict by SA.
            raw_final = analysis.final_json
            track_id = str(analysis.id)
            # cross-lane trace stitch (getattr: test stubs omit the column)
            obs.set_tag("job_id", getattr(analysis, "job_id", None))
    except Exception as exc:
        logger.exception("Phase A failed for slug=%s", slug)
        _persist_fail_marker(aid, slug, f"DB read failed: {exc}")
        return

    flattened = flatten(raw_final if isinstance(raw_final, dict) else {})
    flattened["track_id"] = track_id

    # ── Phase B: load prompt ───────────────────────────────────────────────
    try:
        prompt_version, prompt_body = load_prompt(slug)
    except (KeyError, FileNotFoundError) as exc:
        logger.warning("prompt lookup failed for slug=%s: %s", slug, exc)
        _persist_fail_marker(aid, slug, f"Prompt missing: {exc}")
        return

    # ── Phase C: LLM call (via the metered gateway) ────────────────────────
    # The gateway owns transport retries + model fallback; the two-attempt
    # loop here is only for a malformed-JSON re-prompt (RETRY_SUFFIX), which
    # is distinct from a transport failure.
    user_msg = build_specialist_user_message(flattened, focus="")
    pinned_model = load_prompt_model(slug)  # None → gateway default
    try:
        caller_id: uuid.UUID | None = uuid.UUID(user_id)
    except (ValueError, TypeError, AttributeError):
        caller_id = None

    parsed: dict[str, Any] | None = None
    used_model = "unknown"
    last_err: Exception | None = None

    for attempt in (1, 2):
        msg = user_msg if attempt == 1 else user_msg + RETRY_SUFFIX
        try:
            result = gateway.complete_sync(
                system=prompt_body,
                user=msg,
                purpose="specialist",
                prompt_slug=slug,
                prompt_version=prompt_version,
                model=pinned_model,
                user_id=caller_id,
                correlation_id=analysis_id,
                timeout_s=120,
            )
        except LlmBudgetExceeded as exc:
            # Story 1.4 / FR16: degraded path. Stamp the notice + ensure
            # rule-engine verdicts exist (both idempotent if a prior
            # specialist on the same analysis already triggered). Do NOT
            # write a fail-marker — the degradation banner is the UX, not
            # a per-specialist failure tile.
            logger.info(
                "specialist %s: degradation triggered (reason=%s)",
                slug, exc.reason,
            )
            write_degradation_notice(aid, reason=exc.reason, detail=exc.detail)
            run_rule_engine_for_analysis(aid)
            return
        except LlmError as exc:
            last_err = exc
            logger.info("specialist %s LLM call failed: %s", slug, exc)
            break  # gateway already retried transport — re-prompt won't help
        used_model = result.model
        try:
            parsed = extract_json_object(result.text)
            break
        except ValueError as exc:
            last_err = exc
            logger.info("specialist %s attempt %d: bad JSON: %s", slug, attempt, exc)
            continue

    if parsed is None:
        _persist_fail_marker(aid, slug, f"LLM call failed: {last_err}")
        return

    # ── Phase D: hydrate + validate ────────────────────────────────────────
    final_verdicts: list[VerdictModel] = []
    raw_verdicts = parsed.get("verdicts")
    if not isinstance(raw_verdicts, list):
        _persist_fail_marker(aid, slug, "LLM response missing 'verdicts' array")
        return

    for raw_v in raw_verdicts:
        try:
            hydrated = _hydrate(
                raw_v,
                track_id=track_id,
                slug=slug,
                prompt_version=f"{slug}@{prompt_version}",
                model=used_model,
            )
        except Exception as exc:
            logger.info("hydrate failed for one verdict (slug=%s): %s", slug, exc)
            continue

        result = validate_verdict(hydrated, flattened)
        if result.ok and result.verdict is not None:
            final_verdicts.append(result.verdict)
        else:
            reason = result.failure.reason if result.failure else "unknown"
            logger.info("verdict rejected by validator (slug=%s): %s", slug, reason)
            obs.VALIDATION_REJECTS.labels(slug=slug).inc()  # 10.3: finally queryable

    if not final_verdicts:
        _persist_fail_marker(aid, slug, "No verdicts survived validation")
        return

    # ── Phase E: persist ───────────────────────────────────────────────────
    for v in final_verdicts:
        try:
            _persist_verdict(aid, v)
        except Exception as exc:
            logger.exception("persist failed for slug=%s verdict=%s", slug, v.verdict_id)
            _persist_fail_marker(aid, slug, f"DB write failed: {exc}")
            return

    logger.info(
        "run_specialist done analysis=%s slug=%s wrote=%d",
        analysis_id, slug, len(final_verdicts),
    )
