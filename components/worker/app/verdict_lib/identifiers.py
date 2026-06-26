"""LLM-identifier stage (Phase 5).

Judgment-only specialists that EMIT findings (``source='llm_identifier'``, no fix)
on a completed analysis — the calls a deterministic rule can't make (e.g. "does
the drop actually pay off?"). Mirrors ``degraded.run_rule_engine_for_analysis``
(the every-analysis deterministic stage) but goes through the LLM gateway.

Gating is the cost control: identifiers run on PAID tiers only by default
(``identifiers_paid_only``), bounded by ``max_identifiers_per_analysis``, and a
budget exhaustion stops the stage early (it never fails the analysis). The
deterministic findings remain the floor — identifiers only add to them.

Phase 1 subset = ``trance_arrangement`` (the one genuinely audio-only judge). The
``.als``-gated ``section_contrast`` / ``chord_harmony`` are deferred pending a
grounding check (their fields don't resolve for an audio-only upload).

No ``anthropic`` import here (AR39) — all LLM flows through ``app.llm.gateway``.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from .flatten_analysis import flatten
from .input_grounding import build_specialist_user_message
from .json_extraction import extract_json_object
from .prompt_loader import load_identifier_prompt, load_identifier_prompt_model
from .validator import validate_verdict

logger = logging.getLogger(__name__)

# Phase 1 audio-only identifier roster.
_AUDIO_ONLY_IDENTIFIERS: tuple[str, ...] = ("trance_arrangement",)


def identifiers_enabled(tier: str | None) -> bool:
    """Identifiers run only on paid tiers by default (cost control). With the
    default tier ``"free"`` they stay OFF until Epic 2 stamps a real ``"pro"``."""
    from app.llm.settings import get_llm_settings  # noqa: PLC0415 — keep DB/env out of import
    if not get_llm_settings().identifiers_paid_only:
        return True
    return tier == "pro"


def _eligible_slugs(flattened: dict[str, Any]) -> list[str]:
    """Which identifiers can run given the data present. ``trance_arrangement``
    needs a non-empty ``phase7.section_scores`` — never grade absent structure."""
    has_sections = bool((flattened.get("phase7") or {}).get("section_scores"))
    out: list[str] = []
    for slug in _AUDIO_ONLY_IDENTIFIERS:
        if slug == "trance_arrangement" and not has_sections:
            continue
        out.append(slug)
    return out


def _hydrate_identifier(
    raw: dict[str, Any], *, track_id: str, slug: str, prompt_version: str,
    model: str, index: int,
) -> Any:
    """Build a Verdict from a raw LLM finding, FORCING the identifier-tier fields
    (architecture §4C): ``source='llm_identifier'``, no fix, suspected (judgment
    call), audio_only, a stable ``problem_id``, and not master-rack fixable."""
    from aimusic_shared.verdicts.models import Verdict  # noqa: PLC0415
    from aimusic_shared.verdicts.ulid_helpers import new_verdict_id  # noqa: PLC0415

    body = dict(raw)
    body["verdict_id"] = new_verdict_id()
    body["track_id"] = track_id
    body["specialist"] = slug
    body["prompt_version"] = prompt_version
    body["model"] = model
    body["priority_score"] = 0  # validator recomputes
    body.setdefault("sources", [slug])
    body["related_verdict_ids"] = []
    body.setdefault("user_state", {})
    body.setdefault("created_at", datetime.now(tz=timezone.utc).isoformat())
    # Server-forced identifier-tier fields — the LLM never controls these.
    body["source"] = "llm_identifier"
    body["fix"] = None
    body["suspected"] = True
    body["data_tier"] = "audio_only"
    body["fixable"] = False  # no deterministic arrangement solver — advisory
    body.setdefault("kind", "observation")
    category = body.get("category", "trance_arrangement")
    body["problem_id"] = f"{category}.{slug}.{index}"
    return Verdict(**body)


def run_llm_identifiers_for_analysis(
    analysis_id: str | uuid.UUID, *, tier: str | None, user_id: Any | None,
) -> int:
    """Run the eligible LLM identifiers and persist their findings. Returns the
    count written. Best-effort + idempotent (guarded on an existing
    ``source='llm_identifier'`` row). Gated by tier; bounded by the per-analysis
    cap; a budget exhaustion stamps the degradation notice and stops early."""
    if not identifiers_enabled(tier):
        return 0
    try:
        from sqlalchemy import select  # noqa: PLC0415

        from aimusic_shared.models import Analysis  # noqa: PLC0415
        from aimusic_shared.models import Verdict as VerdictRow  # noqa: PLC0415

        from app.db_sync import SessionFactory  # noqa: PLC0415
        from app.llm import gateway  # noqa: PLC0415
        from app.llm.gateway import LlmBudgetExceeded, LlmError  # noqa: PLC0415
        from app.llm.settings import get_llm_settings  # noqa: PLC0415
        from app.verdict_lib.degraded import _to_row, write_degradation_notice  # noqa: PLC0415

        aid = uuid.UUID(str(analysis_id))
        with SessionFactory.begin() as s:
            analysis = s.get(Analysis, aid)
            if analysis is None:
                logger.warning("identifiers: analysis %s not found", aid)
                return 0
            existing = s.execute(
                select(VerdictRow.id)
                .where(VerdictRow.analysis_id == aid)
                .where(VerdictRow.source == "llm_identifier")
                .limit(1)
            ).first()
            if existing is not None:
                return 0  # idempotent
            raw_final = analysis.final_json
            track_id = str(analysis.id)

        flattened = flatten(raw_final if isinstance(raw_final, dict) else {})
        flattened.setdefault("track_id", track_id)

        cap = get_llm_settings().max_identifiers_per_analysis
        slugs = _eligible_slugs(flattened)[:cap]
        if not slugs:
            return 0

        try:
            caller_id: uuid.UUID | None = uuid.UUID(str(user_id))
        except (ValueError, TypeError, AttributeError):
            caller_id = None

        written = 0
        for slug in slugs:
            try:
                version, body = load_identifier_prompt(slug)
            except (KeyError, FileNotFoundError) as exc:
                logger.warning("identifier prompt missing %s: %s", slug, exc)
                continue
            user_msg = build_specialist_user_message(flattened, focus="")
            pinned = load_identifier_prompt_model(slug)
            try:
                result = gateway.complete_sync(
                    system=body, user=user_msg, purpose="identifier",
                    prompt_slug=slug, prompt_version=version, model=pinned,
                    user_id=caller_id, tier=tier, correlation_id=str(aid),
                    timeout_s=120,
                )
            except LlmBudgetExceeded as exc:
                # Degraded path: stamp the notice + stop. The deterministic
                # findings already exist; never write a fail marker here.
                logger.info("identifiers: budget exceeded (%s) — stopping", exc.reason)
                write_degradation_notice(aid, reason=exc.reason, detail=exc.detail)
                break
            except LlmError as exc:
                logger.info("identifier %s LLM call failed: %s", slug, exc)
                continue
            try:
                parsed = extract_json_object(result.text)
            except ValueError as exc:
                logger.info("identifier %s returned bad JSON: %s", slug, exc)
                continue

            raw_verdicts = parsed.get("verdicts") if isinstance(parsed, dict) else None
            if not isinstance(raw_verdicts, list):
                continue
            survivors = []
            for i, raw_v in enumerate(raw_verdicts):
                try:
                    hyd = _hydrate_identifier(
                        raw_v, track_id=track_id, slug=slug,
                        prompt_version=f"{slug}@{version}", model=result.model, index=i,
                    )
                except Exception as exc:
                    logger.info("identifier %s hydrate failed: %s", slug, exc)
                    continue
                vr = validate_verdict(hyd, flattened)
                if vr.ok and vr.verdict is not None:
                    survivors.append(vr.verdict)
                else:
                    reason = vr.failure.reason if vr.failure else "unknown"
                    logger.info("identifier %s verdict rejected: %s", slug, reason)
            if survivors:
                with SessionFactory.begin() as s:
                    for v in survivors:
                        s.add(_to_row(aid, v))
                        written += 1

        logger.info("identifiers wrote %d findings for analysis=%s", written, aid)
        return written
    except Exception:
        logger.exception("identifier stage failed for analysis=%s", analysis_id)
        return 0
