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
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from .flatten_analysis import flatten
from .input_grounding import build_specialist_user_message
from .json_extraction import extract_json_object
from .prompt_loader import load_identifier_prompt, load_identifier_prompt_model
from .validator import validate_verdict

logger = logging.getLogger(__name__)

# Identifier roster. Each carries the data_tier its evidence uses and a gate on the
# data that must be present — never grade absent data.
@dataclass(frozen=True)
class _IdentifierSpec:
    slug: str
    data_tier: str   # "audio_only" | "project_midi"
    requires: str    # "sections" (phase7) | "midi" (phase8.midi_analysis)


_IDENTIFIERS: tuple[_IdentifierSpec, ...] = (
    _IdentifierSpec("trance_arrangement", "audio_only", "sections"),
    _IdentifierSpec("section_contrast", "project_midi", "midi"),
    _IdentifierSpec("chord_harmony", "project_midi", "midi"),
)


def identifiers_enabled(tier: str | None) -> bool:
    """Identifiers run only on paid tiers by default (cost control). With the
    default tier ``"free"`` they stay OFF until Epic 2 stamps a real ``"pro"``."""
    from app.llm.settings import get_llm_settings  # noqa: PLC0415 — keep DB/env out of import
    if not get_llm_settings().identifiers_paid_only:
        return True
    return tier == "pro"


def _eligible(flattened: dict[str, Any]) -> list[_IdentifierSpec]:
    """Which identifiers can run given the data present. ``trance_arrangement`` needs
    ``phase7.section_scores``; the ``.als``-gated ones need ``phase8.midi_analysis``
    (emitted by phase8_als.py). Never grade absent data."""
    has_sections = bool((flattened.get("phase7") or {}).get("section_scores"))
    has_midi = bool((flattened.get("phase8") or {}).get("midi_analysis"))
    out: list[_IdentifierSpec] = []
    for spec in _IDENTIFIERS:
        if spec.requires == "sections" and not has_sections:
            continue
        if spec.requires == "midi" and not has_midi:
            continue
        out.append(spec)
    return out


def _hydrate_identifier(
    raw: dict[str, Any], *, track_id: str, slug: str, prompt_version: str,
    model: str, index: int, data_tier: str,
) -> Any:
    """Build a Verdict from a raw LLM finding, FORCING the identifier-tier fields
    (architecture §4C): ``source='llm_identifier'``, no fix, suspected (judgment
    call), the spec's ``data_tier``, a stable ``problem_id``, and not master-rack
    fixable."""
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
    body["data_tier"] = data_tier
    body["fixable"] = False  # no deterministic solver for these judgment calls — advisory
    body.setdefault("kind", "observation")
    category = body.get("category", "trance_arrangement")
    body["problem_id"] = f"{category}.{slug}.{index}"
    return Verdict(**body)


def run_llm_identifiers_for_analysis(
    analysis_id: str | uuid.UUID, *, tier: str | None, user_id: Any | None,
    trace_sink: list[dict[str, Any]] | None = None,
) -> int:
    """Run the eligible LLM identifiers and persist their findings. Returns the
    count written. Best-effort + idempotent (guarded on an existing
    ``source='llm_identifier'`` row). Gated by tier; bounded by the per-analysis
    cap; a budget exhaustion stamps the degradation notice and stops early.

    ``trace_sink`` (optional): when a list is passed, each LLM call's full request
    (model, system prompt, user message) and response (raw text + outcome) is
    appended for the run-trace harness."""
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
        specs = _eligible(flattened)[:cap]
        if not specs:
            return 0

        try:
            caller_id: uuid.UUID | None = uuid.UUID(str(user_id))
        except (ValueError, TypeError, AttributeError):
            caller_id = None

        written = 0
        for spec in specs:
            slug = spec.slug
            try:
                version, body = load_identifier_prompt(slug)
            except (KeyError, FileNotFoundError) as exc:
                logger.warning("identifier prompt missing %s: %s", slug, exc)
                continue
            user_msg = build_specialist_user_message(flattened, focus="")
            pinned = load_identifier_prompt_model(slug)
            # Full LLM-routing record for the run trace (input payload now; the
            # output payload is filled in on each outcome below).
            call_rec: dict[str, Any] = {
                "stage": "identifier", "slug": slug,
                "request": {
                    "model": pinned or "(gateway default)",
                    "prompt_slug": slug, "prompt_version": version,
                    "system": body, "user": user_msg,
                },
            }
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
                call_rec["response"] = {"outcome": "budget_exceeded", "reason": exc.reason}
                if trace_sink is not None:
                    trace_sink.append(call_rec)
                write_degradation_notice(aid, reason=exc.reason, detail=exc.detail)
                break
            except LlmError as exc:
                logger.info("identifier %s LLM call failed: %s", slug, exc)
                call_rec["response"] = {"outcome": "error", "error": str(exc)}
                if trace_sink is not None:
                    trace_sink.append(call_rec)
                continue
            try:
                parsed = extract_json_object(result.text)
            except ValueError as exc:
                logger.info("identifier %s returned bad JSON: %s", slug, exc)
                call_rec["response"] = {"outcome": "bad_json", "model": result.model, "raw": result.text}
                if trace_sink is not None:
                    trace_sink.append(call_rec)
                continue

            raw_verdicts = parsed.get("verdicts") if isinstance(parsed, dict) else None
            call_rec["response"] = {
                "outcome": "ok", "model": result.model, "raw": result.text,
                "parsed_verdicts": len(raw_verdicts) if isinstance(raw_verdicts, list) else 0,
            }
            if trace_sink is not None:
                trace_sink.append(call_rec)
            if not isinstance(raw_verdicts, list):
                continue
            survivors = []
            for i, raw_v in enumerate(raw_verdicts):
                try:
                    hyd = _hydrate_identifier(
                        raw_v, track_id=track_id, slug=slug,
                        prompt_version=f"{slug}@{version}", model=result.model, index=i,
                        data_tier=spec.data_tier,
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
