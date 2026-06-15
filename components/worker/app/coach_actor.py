"""Dramatiq actor: generate one grounded coach reply (story 1.5 / AR9 / AR10).

Wire format (2 string args, matches the BFF's ``DramatiqJobQueue`` envelope):

    coach_reply(conversation_id: str, message_id: str)

``message_id`` is the UUID of the pending **assistant** row the BFF inserted
on POST; the user-turn row is already persisted. The actor only loads + updates
this single assistant row.

Lifecycle:

  A. Load. Assistant row + conversation + analysis. Idempotency: bail
     unless ``status == "pending"`` (a dramatiq retry must not double-charge).
  A.1 Degraded short-circuit. If ``analysis.degradation_notice is not None``
      → mark the row ``refused`` with the UX-DR17 offline line.
  B. Build context bundle. flatten(analysis.final_json) + top verdicts +
     optional .als summary + last-10 conversation tail.
  C. Build user-turn. User text never enters ``system=``; it lands in
     ``user=`` between triple-quoted delimiters (NFR12 injection defense).
  D. Gateway call (``purpose="coach"``). Catch ``LlmBudgetExceeded`` → mark
     row ``refused`` with offline line. Catch ``LlmError`` → mark row
     ``error`` with generic message.
  E. Parse + validate. ``extract_json_object`` → ``CoachReplyPayload``.
     Numeric-without-evidence rejection downgrades to ``error``.
  F. Resolve evidence. Drop unresolvable citations.
  G. Persist. UPDATE the assistant row with status + content + evidence
     + refusal_reason + llm_call_id + completed_at.

Failures in any phase mark the row ``error`` (never raise; the dramatiq
retry policy is ``max_retries=1`` and a real retry just re-runs the LLM
call which is wasted spend in most failure modes).
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

import dramatiq

from .coach_lib.context import build_context_bundle, resolve_evidence
from .coach_lib.payload import (
    CoachReplyPayload,
    answer_makes_numeric_claim_without_evidence,
)
from .llm import gateway
from .llm.gateway import LlmBudgetExceeded, LlmError
from .verdict_lib.flatten_analysis import flatten
from .verdict_lib.json_extraction import extract_json_object
from .verdict_lib.prompt_loader import (
    load_coach_grounded,
    load_coach_grounded_model,
)

# NOTE: ``app.db_sync`` raises ``RuntimeError("DATABASE_URL not set")`` at
# import when no env var is set. ``aimusic_shared.models`` is import-safe.
# Both are imported lazily inside the actor / helpers so unit tests can
# stub ``SessionFactory`` without touching the DB. (Same pattern story 1.4
# applied to ``verdict_lib/degraded.py``.)

logger = logging.getLogger(__name__)

# UX-DR17 verbatim — the offline-coach string is rendered identically on the
# Verdicts page (DegradationBanner) and here. Don't paraphrase.
COACH_OFFLINE_BODY = (
    "Coach is offline — your measured analysis and rule-based findings "
    "are unaffected."
)
COACH_GENERIC_ERROR_BODY = (
    "The coach hit a transient error. Please try again."
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


# ── persistence helpers ─────────────────────────────────────────────────────

def _mark_refused(
    message_id: uuid.UUID, *, refusal_reason: str, body: str,
    llm_call_id: str | None = None,
) -> None:
    """Set the assistant row to ``status="refused"`` with the given body +
    reason. Idempotent — only updates if still ``pending``.
    """
    try:
        from .db_sync import SessionFactory  # noqa: PLC0415 — lazy DB import
        from aimusic_shared.models import CoachMessage  # noqa: PLC0415

        with SessionFactory.begin() as s:
            row = s.get(CoachMessage, message_id)
            if row is None or row.status != "pending":
                return
            row.status = "refused"
            row.content = body
            row.evidence = []
            row.refusal_reason = refusal_reason
            row.llm_call_id = llm_call_id
            row.completed_at = _utc_now()
    except Exception:
        logger.exception("mark_refused failed for message %s", message_id)


def _mark_error(
    message_id: uuid.UUID, *, body: str = COACH_GENERIC_ERROR_BODY,
    llm_call_id: str | None = None,
) -> None:
    """Set the assistant row to ``status="error"`` with a generic body.
    Idempotent — only updates if still ``pending``.
    """
    try:
        from .db_sync import SessionFactory  # noqa: PLC0415 — lazy DB import
        from aimusic_shared.models import CoachMessage  # noqa: PLC0415

        with SessionFactory.begin() as s:
            row = s.get(CoachMessage, message_id)
            if row is None or row.status != "pending":
                return
            row.status = "error"
            row.content = body
            row.evidence = []
            row.llm_call_id = llm_call_id
            row.completed_at = _utc_now()
    except Exception:
        logger.exception("mark_error failed for message %s", message_id)


def _mark_complete(
    message_id: uuid.UUID, *, payload: CoachReplyPayload,
    llm_call_id: str | None,
) -> None:
    """Apply a successful reply payload to the assistant row. Idempotent —
    only updates if still ``pending``. Answer → ``complete``; refusal →
    ``refused``.
    """
    new_status = "complete" if payload.kind == "answer" else "refused"
    evidence_json = [e.model_dump() for e in payload.evidence]
    try:
        from .db_sync import SessionFactory  # noqa: PLC0415 — lazy DB import
        from aimusic_shared.models import CoachMessage  # noqa: PLC0415

        with SessionFactory.begin() as s:
            row = s.get(CoachMessage, message_id)
            if row is None or row.status != "pending":
                return
            row.status = new_status
            row.content = payload.body
            row.evidence = evidence_json
            row.refusal_reason = payload.refusal_reason
            row.llm_call_id = llm_call_id
            row.completed_at = _utc_now()
    except Exception:
        logger.exception("mark_complete failed for message %s", message_id)


# ── prompt assembly ────────────────────────────────────────────────────────

def _build_user_turn(
    context_bundle: dict[str, Any],
    user_question: str,
) -> str:
    """Compose the user-turn payload sent to the gateway as ``user=``.

    The system prompt is the unchanged ``CoachGrounded.md`` body; user text
    NEVER appears in ``system=`` (NFR12). User input is wrapped in
    ``<user_input>…</user_input>`` XML tags — Anthropic's recommended
    untrusted-input convention. Triple-quoted delimiters would let a user
    close the block early by including ``\"\"\"`` in their question.

    Story 1.5 code review E-M2: any literal ``</user_input>`` token in the
    user's text is escaped to a visible-but-inert form so the closing tag
    is unambiguous to the model AND to log readers.
    """
    tail = context_bundle.get("conversation_tail") or []
    tail_lines: list[str] = []
    for turn in tail:
        role = turn.get("role", "user")
        body = turn.get("body", "")
        label = "You" if role == "user" else "Coach"
        tail_lines.append(f"{label}: {body}")
    tail_block = "\n".join(tail_lines) if tail_lines else "(first message)"

    safe_question = user_question.replace("</user_input>", "</user_input&#62;")

    bundle_json = json.dumps(context_bundle, indent=2, default=str)
    return (
        "## Context\n\n"
        f"```json\n{bundle_json}\n```\n\n"
        "## Conversation so far\n\n"
        f"{tail_block}\n\n"
        "## User question (untrusted)\n\n"
        f"<user_input>{safe_question}</user_input>\n\n"
        "Respond per the system instructions."
    )


# ── actor ──────────────────────────────────────────────────────────────────

@dramatiq.actor(
    actor_name="coach_reply",
    queue_name="coach",
    max_retries=1,
    time_limit=180_000,  # 3 minutes
)
def coach_reply(
    conversation_id: str, user_message_id: str, assistant_message_id: str,
) -> None:
    """See module docstring.

    The BFF enqueues with three ids so the actor never has to *infer* which
    user row this assistant is replying to (story 1.5 code review B-H2 —
    rapid back-to-back POSTs would otherwise both pick the most-recent user
    in the tail and answer the wrong question).
    """
    cid = uuid.UUID(conversation_id)
    uid_msg = uuid.UUID(user_message_id)
    mid = uuid.UUID(assistant_message_id)
    logger.info(
        "coach_reply start conversation=%s user_msg=%s assistant_msg=%s",
        conversation_id, user_message_id, assistant_message_id,
    )

    # ── Phase A: load assistant row + user row + conversation + analysis ──
    try:
        from sqlalchemy import select  # noqa: PLC0415 — lazy SA usage

        from .db_sync import SessionFactory  # noqa: PLC0415 — lazy DB import
        from aimusic_shared.models import (  # noqa: PLC0415
            Analysis, CoachMessage, Conversation,
        )

        with SessionFactory.begin() as s:
            assistant = s.get(CoachMessage, mid)
            if assistant is None:
                logger.warning("coach_reply: assistant message %s not found",
                               assistant_message_id)
                return
            # Story 1.5 code review B-L1: defensive role assertion. If a
            # malformed queue payload or a future caller passes a user-row
            # id by mistake we would otherwise overwrite a user row.
            if assistant.role != "assistant":
                logger.warning(
                    "coach_reply: %s has role=%r, expected 'assistant' — skipping",
                    assistant_message_id, assistant.role,
                )
                return
            if assistant.status != "pending":
                # Idempotent: a retry hit a row that's already been written.
                logger.info("coach_reply: assistant %s status=%s, skipping",
                            assistant_message_id, assistant.status)
                return

            # Story 1.5 code review B-H2: load the user-question row by the
            # id the BFF gave us. Do NOT infer "most-recent user in tail"
            # — under concurrent POSTs that picks the wrong question.
            user_row = s.get(CoachMessage, uid_msg)
            if user_row is None or user_row.role != "user":
                logger.warning(
                    "coach_reply: user message %s missing or wrong role",
                    user_message_id,
                )
                _mark_error(mid, body=COACH_GENERIC_ERROR_BODY)
                return
            user_question = user_row.content

            conversation = s.get(Conversation, cid)
            if conversation is None:
                logger.warning("coach_reply: conversation %s missing", conversation_id)
                _mark_error(mid, body=COACH_GENERIC_ERROR_BODY)
                return
            analysis = s.get(Analysis, conversation.analysis_id)
            if analysis is None:
                logger.warning("coach_reply: analysis %s missing",
                               conversation.analysis_id)
                _mark_error(mid, body=COACH_GENERIC_ERROR_BODY)
                return

            raw_final = analysis.final_json
            degradation_notice = analysis.degradation_notice
            user_id = conversation.user_id
            analysis_id = analysis.id

            # Conversation tail = all non-pending messages EXCLUDING both
            # the pending assistant row AND the user row we're answering
            # (Phase C inserts the user question explicitly between
            # delimiters). Last 10 only — context.py caps as well, but
            # capping at SQL keeps memory bounded.
            tail_rows = s.execute(
                select(CoachMessage)
                .where(
                    CoachMessage.conversation_id == cid,
                    CoachMessage.id != mid,
                    CoachMessage.id != uid_msg,
                    CoachMessage.status != "pending",
                )
                .order_by(CoachMessage.created_at.asc())
            ).scalars().all()
            tail = [{"role": r.role, "body": r.content} for r in tail_rows]
    except Exception:
        logger.exception("coach_reply Phase A failed for assistant %s",
                         assistant_message_id)
        _mark_error(mid)
        return

    # ── Phase A.1: degraded short-circuit ─────────────────────────────────
    if degradation_notice is not None:
        logger.info("coach_reply: analysis is degraded, short-circuiting")
        _mark_refused(mid, refusal_reason="coach_offline", body=COACH_OFFLINE_BODY)
        return

    if not user_question.strip():
        logger.warning("coach_reply: empty user question on %s", user_message_id)
        _mark_error(mid)
        return

    # Story 1.5 code review E-H1: any unexpected failure in Phases B-G
    # must not leave the assistant row stuck in `pending` (which renders as
    # a perpetual spinner with no error message). The catch-all here pairs
    # with the per-phase catches below for known failure modes.
    try:
        # ── Phase B: build context bundle ──────────────────────────────────
        flattened = flatten(raw_final if isinstance(raw_final, dict) else {})
        verdicts_for_bundle = _load_verdicts_for_bundle(analysis_id=analysis_id)
        bundle = build_context_bundle(
            flattened_analysis=flattened,
            verdicts=verdicts_for_bundle,
            conversation_tail=tail,
        )

        # ── Phase C: build user turn ───────────────────────────────────────
        try:
            version, system_body = load_coach_grounded()
        except FileNotFoundError:
            logger.exception("coach_reply: coach prompt file missing")
            _mark_error(mid)
            return
        model_pin = load_coach_grounded_model()
        user_turn = _build_user_turn(bundle, user_question)

        # ── Phase D: gateway call ──────────────────────────────────────────
        try:
            result = gateway.complete_sync(
                system=system_body,
                user=user_turn,
                purpose="coach",
                prompt_slug="coach_grounded",
                prompt_version=version,
                model=model_pin,
                user_id=user_id,
                correlation_id=str(cid),
                timeout_s=120,
            )
        except LlmBudgetExceeded as exc:
            logger.info(
                "coach_reply: budget/breaker hit (reason=%s) — refusing as offline",
                exc.reason,
            )
            # Story 1.5 code review E-M1: link the budget-rejected refusal
            # to the llm_calls row the gateway wrote (if any). For
            # LlmBudgetExceeded the gateway raises PRE-call so there is no
            # row to link — exc.llm_call_id is None and that's correct.
            _mark_refused(
                mid, refusal_reason="coach_offline", body=COACH_OFFLINE_BODY,
                llm_call_id=exc.llm_call_id,
            )
            return
        except LlmError as exc:
            # Story 1.5 code review E-M1: surface the error row's llm_call_id
            # so forensics can join the user-visible error to the metering row.
            logger.info("coach_reply: LLM call failed for %s: %s",
                        assistant_message_id, exc)
            _mark_error(mid, llm_call_id=exc.llm_call_id)
            return

        # ── Phase E: parse + validate ──────────────────────────────────────
        try:
            parsed = extract_json_object(result.text)
        except ValueError:
            logger.info("coach_reply: extract_json_object failed for %s",
                        assistant_message_id)
            _mark_error(mid, llm_call_id=result.llm_call_id)
            return

        try:
            payload = CoachReplyPayload(**parsed)
        except Exception as exc:  # noqa: BLE001 — Pydantic ValidationError catch-all
            logger.info("coach_reply: payload validation failed for %s: %s",
                        assistant_message_id, exc)
            _mark_error(mid, llm_call_id=result.llm_call_id)
            return

        if answer_makes_numeric_claim_without_evidence(payload):
            logger.info(
                "coach_reply: rejecting numeric answer with no evidence (msg=%s)",
                assistant_message_id,
            )
            _mark_error(mid, llm_call_id=result.llm_call_id)
            return

        # ── Phase F: resolve evidence ──────────────────────────────────────
        payload = payload.model_copy(
            update={"evidence": resolve_evidence(payload.evidence, bundle)},
        )

        # ── Phase G: persist ───────────────────────────────────────────────
        _mark_complete(mid, payload=payload, llm_call_id=result.llm_call_id)
        logger.info(
            "coach_reply done conversation=%s message=%s kind=%s evidence=%d",
            conversation_id, assistant_message_id,
            payload.kind, len(payload.evidence),
        )
    except Exception:
        logger.exception(
            "coach_reply: unexpected failure in Phases B-G for %s",
            assistant_message_id,
        )
        _mark_error(mid)
        return


def _load_verdicts_for_bundle(*, analysis_id: uuid.UUID) -> list[dict[str, Any]]:
    """Top-N verdicts projection for the coach bundle. Pulls only the columns
    the prompt needs; rule-engine verdicts (specialist="rule_engine") are
    included identically to specialist verdicts.
    """
    try:
        from sqlalchemy import select  # noqa: PLC0415

        from .db_sync import SessionFactory  # noqa: PLC0415 — lazy DB import
        from aimusic_shared.models import Verdict  # noqa: PLC0415

        with SessionFactory() as s:
            rows = s.execute(
                select(Verdict)
                .where(Verdict.analysis_id == analysis_id)
                .order_by(Verdict.priority_score.desc())
                .limit(64)  # over-fetch slightly; context.py caps at 40
            ).scalars().all()
            return [
                {
                    "specialist": r.specialist,
                    "severity": r.severity,
                    "category": r.category,
                    "headline": r.headline,
                    "summary": r.summary,
                    "metric_line": r.metric_line,
                    "priority_score": r.priority_score,
                }
                for r in rows
            ]
    except Exception:
        logger.exception("coach_reply: verdict projection failed; using empty list")
        return []
