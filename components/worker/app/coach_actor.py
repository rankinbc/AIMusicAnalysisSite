"""Dramatiq actor: generate one grounded coach reply (story 1.5 / AR9 / AR10).

Wire format (3 string args, matches the BFF's ``DramatiqJobQueue`` envelope):

    coach_reply(conversation_id: str, user_message_id: str, assistant_message_id: str)

``assistant_message_id`` is the UUID of the pending assistant row the BFF
inserted on POST; ``user_message_id`` is the user-turn row in the same
conversation. The actor only loads + updates the assistant row.

Lifecycle (story 1.5 baseline; story 1.6 swaps Phase D + E onto streaming):

  A. Load. Assistant row + user row + conversation + analysis. Idempotency:
     bail unless ``status == "pending"`` (a dramatiq retry must not double-charge).
  A.1 Degraded short-circuit. If ``analysis.degradation_notice is not None``
      → mark the row ``refused`` with the UX-DR17 offline line.
  B. Build context bundle. flatten(analysis.final_json) + top verdicts +
     optional .als summary + last-10 conversation tail.
  C. Build user-turn. User text never enters ``system=``; it lands in
     ``user=`` between ``<user_input>…</user_input>`` delimiters (NFR12).
  D. Stream gateway call (``purpose="coach"``, story 1.6). Each delta
     feeds the v2 sentinel splitter; prose chunks publish as ``token``
     frames on ``coach:{cid}:{mid}``. Catch ``LlmBudgetExceeded`` → publish
     ``error(code="coach_offline")`` + mark row ``refused``. Catch
     ``LlmError`` → publish ``error(code="coach_error")`` + mark row
     ``error``.
  E. End-of-stream parse + validate (v2 contract). ``splitter.finish()``
     yields (prose, evidence_json, saw_sentinel). When the sentinel was
     missed → persist a partial answer (cancel-mid-stream branch). When
     present → parse Section 2 JSON, re-inject ``body`` = prose, run
     ``CoachReplyPayload`` + numeric-without-evidence rejection.
  F. Resolve evidence. Drop unresolvable citations.
  G. Persist. UPDATE the assistant row with status + content + evidence
     + refusal_reason + llm_call_id + completed_at. Publish ``done`` /
     ``refusal`` frame.

Failures in any phase mark the row ``error`` AND publish an ``error``
frame so SSE consumers never see a silent dead stream (story 1.6 AR9
"never a silent dead stream"). The dramatiq retry policy is
``max_retries=1``; the Phase-A status check makes a retry a no-op.
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

import dramatiq

from . import obs
from .coach_lib.cancel import cancel_check_for
from .coach_lib.context import build_context_bundle, resolve_evidence
from .coach_lib.payload import (
    CoachReplyPayload,
    answer_makes_numeric_claim_without_evidence,
)
from .coach_lib.stream_parser import StreamSplitter
from .coach_lib.stream_publisher import CoachStreamPublisher
from .llm import gateway
from .llm.gateway import LlmBudgetExceeded, LlmError
from .verdict_lib.flatten_analysis import flatten
from .verdict_lib.json_extraction import extract_json_object
from .verdict_lib.prompt_loader import (
    load_coach_grounded,
    load_coach_grounded_model,
    load_coach_teach,
    load_coach_teach_model,
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


def _mark_complete_partial(
    message_id: uuid.UUID, *, body: str, llm_call_id: str | None,
) -> None:
    """Story 1.6 cancel-mid-stream branch — persist the partial prose we
    streamed before the SSE consumer disconnected. Status = ``complete``
    with empty evidence (no Section 2 was emitted, so nothing to cite).
    Idempotent — only updates if still ``pending``.
    """
    try:
        from .db_sync import SessionFactory  # noqa: PLC0415 — lazy DB import
        from aimusic_shared.models import CoachMessage  # noqa: PLC0415

        with SessionFactory.begin() as s:
            row = s.get(CoachMessage, message_id)
            if row is None or row.status != "pending":
                return
            row.status = "complete"
            row.content = body
            row.evidence = []
            row.refusal_reason = None
            row.llm_call_id = llm_call_id
            row.completed_at = _utc_now()
    except Exception:
        logger.exception(
            "mark_complete_partial failed for message %s", message_id,
        )


# ── prompt assembly ────────────────────────────────────────────────────────

def _render_teach_block(teach_units: list[Any], catalog: list[str]) -> str:
    """Render the teach-mode ``## Teaching units`` + ``## Lesson catalog``
    block injected below ``## Context``. Empty (``""``) when there's nothing to
    inject, so qa-mode output stays byte-identical to the grounded path.
    """
    if not teach_units and not catalog:
        return ""
    parts: list[str] = []
    if teach_units:
        unit_blocks: list[str] = []
        for u in teach_units:
            paths = ", ".join(getattr(u, "reference_paths", ()) or [])
            unit_blocks.append(
                f"### {u.title} ({u.category})\n"
                f"Reference paths for THIS track: {paths or '(none)'}\n\n"
                f"{u.body}"
            )
        parts.append("## Teaching units\n\n" + "\n\n".join(unit_blocks))
    if catalog:
        catalog_lines = "\n".join(f"- {t}" for t in catalog)
        parts.append("## Lesson catalog\n\n" + catalog_lines)
    return "\n\n".join(parts) + "\n\n"


def _build_user_turn(
    context_bundle: dict[str, Any],
    user_question: str,
    *,
    teach_units: list[Any] | None = None,
    catalog: list[str] | None = None,
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
    teach_block = _render_teach_block(teach_units or [], catalog or [])
    return (
        "## Context\n\n"
        f"```json\n{bundle_json}\n```\n\n"
        f"{teach_block}"
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
    # 10.3: conversation id is the coach lane's correlation; the analysis id
    # tag is added in Phase A once the conversation row is loaded (closing
    # the upload→report→coach chain seam).
    obs.set_correlation(conversation_id)
    logger.info(
        "coach_reply start conversation=%s user_msg=%s assistant_msg=%s",
        conversation_id, user_message_id, assistant_message_id,
    )

    # Story 1.6 code review P7: construct the publisher BEFORE Phase A so
    # every early-exit branch (DB hiccup, missing row, degraded analysis,
    # empty question) can publish a terminal SSE frame. An SSE consumer
    # racing /stream during Phase A would otherwise hit the 30 s idle
    # fallback before seeing any terminal frame. Publisher only touches
    # Redis on the first publish call (lazy module client).
    publisher = CoachStreamPublisher(conversation_id=cid, message_id=mid)

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
                publisher.error(code="coach_error", message=COACH_GENERIC_ERROR_BODY)
                _mark_error(mid, body=COACH_GENERIC_ERROR_BODY)
                return
            user_question = user_row.content
            # teach-mode flag rides the user row (default qa); the dramatiq
            # envelope is unchanged (still 3 string args).
            mode = getattr(user_row, "mode", None) or "qa"

            conversation = s.get(Conversation, cid)
            if conversation is None:
                logger.warning("coach_reply: conversation %s missing", conversation_id)
                publisher.error(code="coach_error", message=COACH_GENERIC_ERROR_BODY)
                _mark_error(mid, body=COACH_GENERIC_ERROR_BODY)
                return
            analysis = s.get(Analysis, conversation.analysis_id)
            if analysis is None:
                logger.warning("coach_reply: analysis %s missing",
                               conversation.analysis_id)
                publisher.error(code="coach_error", message=COACH_GENERIC_ERROR_BODY)
                _mark_error(mid, body=COACH_GENERIC_ERROR_BODY)
                return

            raw_final = analysis.final_json
            degradation_notice = analysis.degradation_notice
            user_id = conversation.user_id
            analysis_id = analysis.id
            # 10.3: stitch the coach lane onto the analysis correlation chain.
            obs.set_tag("analysis_id", analysis_id)

            # Conversation tail = all non-pending messages EXCLUDING both
            # the pending assistant row AND the user row we're answering
            # (Phase C inserts the user question explicitly between
            # delimiters). Last 10 only — context.py caps as well, but
            # capping at SQL keeps memory bounded (story 1.5 deferred
            # follow-up). Fetch newest-first + LIMIT, then reverse to restore
            # chronological order for the prompt.
            tail_rows = s.execute(
                select(CoachMessage)
                .where(
                    CoachMessage.conversation_id == cid,
                    CoachMessage.id != mid,
                    CoachMessage.id != uid_msg,
                    CoachMessage.status != "pending",
                )
                .order_by(CoachMessage.created_at.desc())
                .limit(10)
            ).scalars().all()
            tail = [
                {"role": r.role, "body": r.content}
                for r in reversed(tail_rows)
            ]
    except Exception:
        logger.exception("coach_reply Phase A failed for assistant %s",
                         assistant_message_id)
        publisher.error(code="coach_error", message=COACH_GENERIC_ERROR_BODY)
        _mark_error(mid)
        return

    # ── Phase A.1: degraded short-circuit ─────────────────────────────────
    if degradation_notice is not None:
        logger.info("coach_reply: analysis is degraded, short-circuiting")
        publisher.refusal(reason="coach_offline", body=COACH_OFFLINE_BODY)
        _mark_refused(mid, refusal_reason="coach_offline", body=COACH_OFFLINE_BODY)
        return

    if not user_question.strip():
        logger.warning("coach_reply: empty user question on %s", user_message_id)
        publisher.error(code="coach_error", message=COACH_GENERIC_ERROR_BODY)
        _mark_error(mid)
        return

    # Story 1.5 code review E-H1 + story 1.6: any unexpected failure in
    # Phases B-G must not leave the assistant row stuck in `pending`
    # (perpetual spinner) AND must publish a terminal SSE frame so
    # subscribers never see a silent dead stream (AC4 / AR9).
    try:
        # ── Phase B: build context bundle ──────────────────────────────────
        flattened = flatten(raw_final if isinstance(raw_final, dict) else {})
        verdicts_for_bundle = _load_verdicts_for_bundle(analysis_id=analysis_id)
        bundle = build_context_bundle(
            flattened_analysis=flattened,
            verdicts=verdicts_for_bundle,
            conversation_tail=tail,
        )

        # ── Phase C: build user turn (teach vs grounded) ───────────────────
        teach_units: list[Any] = []
        catalog: list[str] = []
        if mode == "teach":
            # Selection is fail-soft: a unit-loading bug must not break the
            # turn — fall back to no units (the prompt then teaches general
            # craft). Mirrors resolve_evidence's never-raise discipline.
            try:
                from .coach_lib.teach import (  # noqa: PLC0415 — lazy
                    load_units, select_units,
                )
                teach_units, catalog = select_units(
                    user_question, verdicts_for_bundle, load_units(),
                )
            except Exception:
                logger.exception(
                    "coach_reply: teach unit selection failed; continuing "
                    "without units",
                )
                teach_units, catalog = [], []
            try:
                version, system_body = load_coach_teach()
            except FileNotFoundError:
                logger.exception("coach_reply: teach prompt file missing")
                publisher.error(code="coach_error", message=COACH_GENERIC_ERROR_BODY)
                _mark_error(mid)
                return
            model_pin = load_coach_teach_model()
            prompt_slug = "coach_teach"
        else:
            try:
                version, system_body = load_coach_grounded()
            except FileNotFoundError:
                logger.exception("coach_reply: coach prompt file missing")
                publisher.error(code="coach_error", message=COACH_GENERIC_ERROR_BODY)
                _mark_error(mid)
                return
            model_pin = load_coach_grounded_model()
            prompt_slug = "coach_grounded"

        user_turn = _build_user_turn(
            bundle, user_question, teach_units=teach_units, catalog=catalog,
        )

        # ── Phase D: stream gateway call (story 1.6) ───────────────────────
        splitter = StreamSplitter()
        cancel_check = cancel_check_for(mid)
        final_event_result: Any | None = None
        try:
            for ev in gateway.stream_complete_sync(
                system=system_body,
                user=user_turn,
                purpose="coach",
                prompt_slug=prompt_slug,
                prompt_version=version,
                model=model_pin,
                user_id=user_id,
                correlation_id=str(cid),
                timeout_s=120,
                cancel_check=cancel_check,
            ):
                if ev.kind == "delta":
                    prose_chunk = splitter.feed(ev.text)
                    if prose_chunk:
                        publisher.token(prose_chunk)
                elif ev.kind == "final":
                    final_event_result = ev.result
        except LlmBudgetExceeded as exc:
            logger.info(
                "coach_reply: budget/breaker hit (reason=%s) — refusing as offline",
                exc.reason,
            )
            # Story 1.5 code review E-M1: link the budget-rejected refusal
            # to the llm_calls row the gateway wrote (if any). For
            # LlmBudgetExceeded the gateway raises PRE-call so there is no
            # row to link — exc.llm_call_id is None and that's correct.
            publisher.error(code="coach_offline", message=COACH_OFFLINE_BODY)
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
            publisher.error(code="coach_error", message=COACH_GENERIC_ERROR_BODY)
            _mark_error(mid, llm_call_id=exc.llm_call_id)
            return

        llm_call_id = (
            final_event_result.llm_call_id if final_event_result is not None else None
        )

        # ── Phase E: end-of-stream parse + validate (v2 contract) ──────────
        parsed = splitter.finish()

        if not parsed.saw_sentinel:
            # Cancel-mid-stream OR a model crash before Section 2. Persist
            # whatever prose we streamed as a partial answer; SSE consumers
            # already saw the tokens, so a typed ``done`` (with no evidence)
            # closes the stream cleanly.
            partial_body = parsed.prose.strip()
            if partial_body:
                logger.info(
                    "coach_reply: cancel-mid-prose for %s — persisting partial",
                    assistant_message_id,
                )
                # Story 1.6 code review P5: persist BEFORE publishing the
                # terminal frame so a DB failure leaves the row in error,
                # not in pending with a clean ``done`` already delivered.
                # Phase G uses the same persist-then-publish order.
                _mark_complete_partial(
                    mid, body=partial_body, llm_call_id=llm_call_id,
                )
                publisher.done(evidence=[])
            else:
                # Nothing usable streamed — treat as error.
                logger.info(
                    "coach_reply: empty pre-sentinel stream for %s — marking error",
                    assistant_message_id,
                )
                publisher.error(code="coach_error", message=COACH_GENERIC_ERROR_BODY)
                _mark_error(mid, llm_call_id=llm_call_id)
            return

        # Sentinel was seen — parse Section 2 and re-inject the prose body
        # so ``CoachReplyPayload`` (which still has ``body``) validates.
        try:
            meta = extract_json_object(parsed.evidence_json)
        except ValueError:
            logger.info(
                "coach_reply: Section-2 JSON parse failed for %s",
                assistant_message_id,
            )
            publisher.error(code="coach_parse_failed", message=COACH_GENERIC_ERROR_BODY)
            _mark_error(mid, llm_call_id=llm_call_id)
            return

        meta["body"] = parsed.prose.strip()
        try:
            payload = CoachReplyPayload(**meta)
        except Exception as exc:  # noqa: BLE001 — Pydantic ValidationError catch-all
            logger.info(
                "coach_reply: payload validation failed for %s: %s",
                assistant_message_id, exc,
            )
            publisher.error(code="coach_parse_failed", message=COACH_GENERIC_ERROR_BODY)
            _mark_error(mid, llm_call_id=llm_call_id)
            return

        # Teach mode states general craft numbers ("-1 dBTP", "200-500 Hz")
        # that are NOT track values and have no path — so the numeric gate is
        # skipped in teach mode. Track-specific claims are still required to
        # cite a resolvable path (enforced by the prompt + Phase F resolution).
        if mode != "teach" and answer_makes_numeric_claim_without_evidence(payload):
            logger.info(
                "coach_reply: rejecting numeric answer with no evidence (msg=%s)",
                assistant_message_id,
            )
            publisher.error(code="coach_parse_failed", message=COACH_GENERIC_ERROR_BODY)
            _mark_error(mid, llm_call_id=llm_call_id)
            return

        # ── Phase F: resolve evidence ──────────────────────────────────────
        payload = payload.model_copy(
            update={"evidence": resolve_evidence(payload.evidence, bundle)},
        )
        evidence_dicts = [e.model_dump() for e in payload.evidence]

        # ── Phase G: persist + publish terminal frame ──────────────────────
        _mark_complete(mid, payload=payload, llm_call_id=llm_call_id)
        if payload.kind == "answer":
            publisher.done(evidence=evidence_dicts)
        else:
            publisher.refusal(
                reason=payload.refusal_reason or "out_of_scope",
                body=payload.body,
            )
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
        publisher.error(code="coach_error", message=COACH_GENERIC_ERROR_BODY)
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
