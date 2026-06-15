"""Streaming entrypoint for the LLM gateway (story 1.6 / AR9 / AR44).

Sibling of :mod:`gateway` — extracted so ``gateway.py`` stays under the
500-line CLAUDE.md ceiling. AR39 lint allows ``anthropic`` imports
anywhere in ``app/llm/`` (the package boundary is what matters; see
``components/worker/tests/test_enforcement_lints.py``).

Only the **coach** purpose consumes this entrypoint today. Triage and
specialist actors stay on the batch :func:`gateway.complete_sync` path.

Threading model — dramatiq actors are sync ``def``, so the streaming
producer runs in a background thread driving its own ``asyncio.run`` loop
and forwards text deltas to the consumer via a ``queue.Queue``. The
consumer (the actor) yields each delta and polls ``cancel_check()``
between yields. On cancel the consumer flips a ``threading.Event`` the
producer checks before its next ``async for`` iteration; the SDK stream
is then ``close()``-d cleanly and the partial usage is captured for the
single ``llm_calls`` row written in the ``finally``.

Metering invariant (story 1.3): exactly ONE ``llm_calls`` row per call,
including cancelled and errored ones. Streaming uses ``record_llm_call``
identically; the row id is generated up-front so it can be attached to
the trailing :class:`GatewayStreamEvent` (``kind="final"``) and stamped
into ``coach_messages.llm_call_id`` by the actor.

Retry policy (story 1.6 code review P2): mirrors :func:`gateway.complete`
— transient errors that fire BEFORE the first delta (timeout / rate
limit / 5xx) get backoff + retry then a fallback-model attempt. Once
the first delta has yielded, retries are NOT attempted — partial output
is final.

Circuit breaker (story 1.6 code review P3): every terminal path through
:func:`stream_complete_sync` calls ``_budget.record_outcome`` exactly
once (``"ok"`` on natural completion, ``"error"`` on retry exhaustion or
mid-stream error). Streaming-only failures correctly tick the AR8
breaker.
"""
from __future__ import annotations

import asyncio
import logging
import queue
import threading
import time
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Callable, Iterator, Literal

import anthropic

from aimusic_shared.verdicts.ulid_helpers import new_llm_call_id

from .errors import (
    LlmInvocationError,
    LlmRateLimitError,
    LlmServerError,
    LlmTimeoutError,
)
from .fake import fake_coach_stream_chunks, fake_response_text
from .settings import get_llm_settings

logger = logging.getLogger(__name__)

# Sentinel models / constants — mirror gateway.py's choices.
_FAKE_MODEL = "fake"

# Retryable provider errors — same set as gateway.py's ``_RETRYABLE``.
_RETRYABLE = (LlmTimeoutError, LlmRateLimitError, LlmServerError)


@dataclass(frozen=True)
class GatewayStreamEvent:
    """One event from :func:`stream_complete_sync`.

    Two kinds:
      * ``kind="delta"`` — a chunk of text just arrived from the model.
        ``text`` is the incremental chunk (NOT the cumulative buffer);
        ``result`` is ``None``.
      * ``kind="final"`` — the stream ended (successfully OR via cancel
        OR via a non-retryable error). ``text`` is the FULL accumulated
        text; ``result`` is a :class:`GatewayResult`-compatible record
        carrying the metering row id and totals.
    """

    kind: Literal["delta", "final"]
    text: str = ""
    # Local import-free shape (avoids a circular import with gateway.py).
    # The actor uses ``.llm_call_id``, ``.cost_usd``, ``.input_tokens``,
    # ``.output_tokens``, ``.model``, ``.outcome``, ``.latency_ms``, ``.text``.
    result: "GatewayResultLike | None" = None


@dataclass(frozen=True)
class GatewayResultLike:
    """Streaming-flavored result. Field set + types match
    :class:`gateway.GatewayResult` so the actor handles both paths
    interchangeably."""

    text: str
    model: str
    input_tokens: int
    output_tokens: int
    cost_usd: Decimal
    outcome: str
    latency_ms: int
    llm_call_id: str | None = None


# ── public API ──────────────────────────────────────────────────────────────

def stream_complete_sync(
    *,
    system: str,
    user: str,
    purpose: str,
    prompt_slug: str | None = None,
    prompt_version: str | None = None,
    model: str | None = None,
    user_id: Any | None = None,
    tier: str | None = None,
    correlation_id: str | None = None,
    max_tokens: int = 4096,
    timeout_s: int | None = None,
    cancel_check: Callable[[], bool] | None = None,
) -> Iterator[GatewayStreamEvent]:
    """Synchronous streaming wrapper. Yields ``delta`` events while the
    model writes, then one terminal ``final`` event carrying the
    metering result.

    Semantics matched to :func:`gateway.complete_sync`:
    * Budget + circuit breaker check fires PRE-stream (un-metered on
      :class:`LlmBudgetExceeded`).
    * ``LLM_FAKE=1`` short-circuits to a deterministic fake stream (one
      metering row, zero spend).
    * Exactly one ``llm_calls`` row written per call (success, cancel,
      OR error — written either by ``_stream_attempt`` for success/
      mid-error or by this wrapper for retry-exhaustion).
    * Pre-first-delta transient errors retry with backoff then try the
      fallback model (same policy as :func:`gateway.complete`). Once
      the first delta yields, retries are NOT attempted.
    * Every terminal path through this generator calls
      ``_budget.record_outcome`` exactly once.

    The ``cancel_check`` closure is polled between consumer yields. When
    it returns ``True`` the producer's stream is closed cleanly and the
    iterator terminates with a ``final`` event.
    """
    settings = get_llm_settings()
    timeout_s = settings.llm_timeout_s if timeout_s is None else timeout_s
    effective_tier = tier or settings.llm_default_tier

    # Story 1.4: budget + circuit-breaker guard fires PRE-call, un-metered.
    # Lazy import keeps the streaming module DB-import-free.
    from . import budget as _budget  # noqa: PLC0415 — deliberate lazy
    _budget.check_budget(tier=effective_tier, purpose=purpose, user_id=user_id)

    if settings.llm_fake:
        try:
            yield from _fake_stream(
                purpose=purpose, prompt_slug=prompt_slug,
                prompt_version=prompt_version, user_id=user_id,
                tier=effective_tier, correlation_id=correlation_id,
            )
        except Exception:
            _budget.record_outcome(outcome="error")
            raise
        _budget.record_outcome(outcome="ok")
        return

    primary = model or settings.llm_default_model
    models_to_try = [primary]
    if settings.llm_fallback_model and settings.llm_fallback_model != primary:
        models_to_try.append(settings.llm_fallback_model)

    last_exc: Exception | None = None
    last_model = primary

    for attempt_model in models_to_try:
        last_model = attempt_model
        give_up = False
        for retry in range(settings.llm_max_retries + 1):
            gen = _stream_attempt(
                system=system, user=user, model=attempt_model,
                purpose=purpose, prompt_slug=prompt_slug,
                prompt_version=prompt_version, user_id=user_id,
                tier=effective_tier, correlation_id=correlation_id,
                max_tokens=max_tokens, timeout_s=timeout_s,
                cancel_check=cancel_check,
            )
            try:
                first_event = next(gen)
            except _RETRYABLE as e:
                last_exc = e
                if retry < settings.llm_max_retries:
                    time.sleep(_RETRY_BASE_S * (2 ** retry))
                    continue
                break  # retryable exhausted for this model → try fallback
            except StopIteration:
                # Defensive: a stream that produced zero events. Treat as
                # an empty success — no row written by _stream_attempt,
                # no breaker tick.
                _budget.record_outcome(outcome="ok")
                return
            except Exception as e:  # noqa: BLE001 — non-retryable provider error
                last_exc = e
                give_up = True
                break

            # First event yielded — stream is live. Lock in this attempt
            # and pass through the rest. Track the trailing ``final``
            # event's outcome so the breaker reflects mid-stream errors.
            last_event = first_event
            try:
                yield first_event
                for ev in gen:
                    last_event = ev
                    yield ev
            except Exception:
                _budget.record_outcome(outcome="error")
                raise
            final_outcome = "ok"
            if (
                last_event.kind == "final"
                and last_event.result is not None
                and last_event.result.outcome == "error"
            ):
                final_outcome = "error"
            _budget.record_outcome(outcome=final_outcome)
            return
        if give_up:
            break

    # Retries (+ fallback) exhausted before any delta yielded → write
    # ONE error row + tick the breaker + raise with llm_call_id attached.
    from .gateway import record_llm_call  # noqa: PLC0415 — late import to avoid cycle
    call_id = new_llm_call_id()
    record_llm_call(
        user_id=user_id, tier=effective_tier, purpose=purpose,
        prompt_slug=prompt_slug, prompt_version=prompt_version,
        model=last_model, input_tokens=0, output_tokens=0,
        cost_usd=Decimal("0"), latency_ms=0,
        outcome="error", correlation_id=correlation_id, row_id=call_id,
    )
    _budget.record_outcome(outcome="error")
    err = LlmInvocationError(
        f"streaming LLM call failed (purpose={purpose} slug={prompt_slug}): {last_exc}"
    )
    err.llm_call_id = call_id  # type: ignore[attr-defined]
    raise err from last_exc


# Tunable backoff base (seconds). Mirrors gateway._RETRY_BASE_S. Tests
# monkeypatch to 0 for speed.
_RETRY_BASE_S = 0.5


# ── fake path (AR41) ────────────────────────────────────────────────────────

def _fake_stream(
    *, purpose: str, prompt_slug: str | None, prompt_version: str | None,
    user_id: Any | None, tier: str | None, correlation_id: str | None,
) -> Iterator[GatewayStreamEvent]:
    """Deterministic fake stream — coach replies are split into ≥3 deltas
    so the front-end can be exercised end-to-end with no spend (AR41,
    AC2). Non-coach purposes get a single delta carrying the full canned
    text; this path is not exercised in slice 1 but kept symmetric.
    """
    from .gateway import record_llm_call  # noqa: PLC0415 — late import to avoid cycle

    chunks: list[str]
    if purpose == "coach":
        chunks = list(fake_coach_stream_chunks())
        full_text = "".join(chunks)
    else:
        full_text = fake_response_text(purpose=purpose, prompt_slug=prompt_slug)
        chunks = [full_text]

    call_id = new_llm_call_id()
    record_llm_call(
        user_id=user_id, tier=tier, purpose=purpose, prompt_slug=prompt_slug,
        prompt_version=prompt_version, model=_FAKE_MODEL,
        input_tokens=0, output_tokens=0, cost_usd=Decimal("0"),
        latency_ms=0, outcome="ok", correlation_id=correlation_id,
        row_id=call_id,
    )

    for chunk in chunks:
        yield GatewayStreamEvent(kind="delta", text=chunk)

    yield GatewayStreamEvent(
        kind="final", text=full_text,
        result=GatewayResultLike(
            text=full_text, model=_FAKE_MODEL,
            input_tokens=0, output_tokens=0, cost_usd=Decimal("0"),
            outcome="ok", latency_ms=0, llm_call_id=call_id,
        ),
    )


# ── real streaming path ─────────────────────────────────────────────────────

# Inter-thread message kinds.
_DELTA, _FINAL, _ERROR, _DONE = "delta", "final", "error", "done"


def _stream_attempt(
    *, system: str, user: str, model: str,
    purpose: str, prompt_slug: str | None, prompt_version: str | None,
    user_id: Any | None, tier: str | None, correlation_id: str | None,
    max_tokens: int, timeout_s: int,
    cancel_check: Callable[[], bool] | None,
) -> Iterator[GatewayStreamEvent]:
    """One streaming attempt against one model. Bridges the async
    ``AsyncMessageStream`` to a sync iterator via a background thread +
    ``queue.Queue``.

    Three terminal outcomes:
      * **Pre-yield error** — the producer raised before any delta
        reached the consumer. This function RAISES (no metering row
        written here; the wrapper's retry loop decides whether to
        retry or write a final error row).
      * **Success** — all deltas yielded, then one ``final`` event
        carrying ``outcome="ok"`` and the metering row id. ONE
        ``llm_calls`` row written via :func:`record_llm_call`.
      * **Mid-stream error** — at least one delta yielded, then the
        producer raised. ONE ``llm_calls`` row written with
        ``outcome="error"`` (so the AR8 breaker counts it). A trailing
        ``final`` event is yielded with ``outcome="error"`` so the actor
        can persist the partial text via its existing partial path. The
        exception is logged but NOT re-raised — the actor decides on
        partial-persist via the standard ``saw_sentinel=False`` branch.
    """
    from .gateway import (  # noqa: PLC0415 — late import to avoid cycle
        _acquire, _safe_cost, record_llm_call,
    )

    # Pre-allocate the metering row id so the trailing ``final`` event can
    # carry it AND the actor can stamp it on ``coach_messages.llm_call_id``.
    call_id = new_llm_call_id()
    t0 = time.monotonic()
    cancel_event = threading.Event()
    out_q: queue.Queue[tuple[str, Any]] = queue.Queue()

    async def producer() -> None:
        client = anthropic.AsyncAnthropic(
            api_key=get_llm_settings().anthropic_api_key, max_retries=0,
        )
        try:
            # AR6: weighted semaphore acquisition, same as ``gateway.complete``.
            from .gateway import _semaphores  # noqa: PLC0415
            g_sem, c_sem = _semaphores()
            async with _acquire(g_sem, c_sem, purpose):
                try:
                    async with client.messages.stream(
                        model=model, max_tokens=max_tokens, system=system,
                        messages=[{"role": "user", "content": user}],
                        timeout=float(timeout_s),
                    ) as stream:
                        cancelled = False
                        async for chunk in stream.text_stream:
                            if cancel_event.is_set():
                                cancelled = True
                                await stream.close()
                                break
                            out_q.put((_DELTA, chunk))
                        # Story 1.6 code review P6: use
                        # ``current_message_snapshot`` after ``close()`` —
                        # it carries the partial usage block and (unlike
                        # ``get_final_message()``) is safe to read after
                        # an explicit stream close. Natural completion
                        # uses ``get_final_message()`` for the full
                        # assembled message.
                        if cancelled:
                            snapshot = getattr(
                                stream, "current_message_snapshot", None,
                            )
                        else:
                            snapshot = await stream.get_final_message()
                        usage = getattr(snapshot, "usage", None) if snapshot else None
                        in_tok = getattr(usage, "input_tokens", 0) or 0
                        out_tok = getattr(usage, "output_tokens", 0) or 0
                        out_q.put((_FINAL, (in_tok, out_tok)))
                except (anthropic.APITimeoutError, anthropic.APIConnectionError) as e:
                    out_q.put((_ERROR, LlmTimeoutError(str(e))))
                except anthropic.RateLimitError as e:
                    out_q.put((_ERROR, LlmRateLimitError(str(e))))
                except anthropic.InternalServerError as e:
                    out_q.put((_ERROR, LlmServerError(str(e))))
                except anthropic.APIStatusError as e:
                    out_q.put((_ERROR, LlmInvocationError(str(e))))
                except anthropic.AnthropicError as e:
                    out_q.put((_ERROR, LlmInvocationError(str(e))))
        finally:
            aclose = getattr(client, "aclose", None)
            if aclose is not None:
                try:
                    await aclose()
                except Exception:  # noqa: BLE001
                    logger.debug("aclose failed", exc_info=True)
            out_q.put((_DONE, None))

    def runner() -> None:
        try:
            asyncio.run(producer())
        except Exception:  # noqa: BLE001 — caller drains via the queue
            logger.exception("stream producer crashed")
            out_q.put((_DONE, None))

    t = threading.Thread(target=runner, daemon=True)
    t.start()

    accumulated: list[str] = []
    in_tok = 0
    out_tok = 0
    err: Exception | None = None
    saw_any_delta = False

    try:
        while True:
            kind, payload = out_q.get()
            if kind == _DELTA:
                accumulated.append(payload)
                saw_any_delta = True
                yield GatewayStreamEvent(kind="delta", text=payload)
                if cancel_check is not None and cancel_check():
                    cancel_event.set()
            elif kind == _FINAL:
                in_tok, out_tok = payload
            elif kind == _ERROR:
                err = payload
            elif kind == _DONE:
                break
    finally:
        # Make sure the producer thread exits even if the consumer raises.
        cancel_event.set()
        t.join(timeout=5)

    full_text = "".join(accumulated)
    latency_ms = int((time.monotonic() - t0) * 1000)

    # Pre-yield error → wrapper decides retry/exhaustion. No metering here.
    # Story 1.5 E-M1: attach the pre-allocated row id so an error caught by
    # the wrapper still has a stable ULID to thread through if the wrapper
    # opts to write a row (today it writes its own; future paths may reuse).
    if err is not None and not saw_any_delta:
        err.llm_call_id = call_id  # type: ignore[attr-defined]
        raise err

    # Mid-stream error or natural completion → ONE metering row written
    # here. Story 1.6 code review P4: surface mid-stream errors via the
    # final event's ``outcome="error"`` instead of swallowing silently —
    # the breaker counts it (P3 wrapper inspects the trailing event) and
    # the error is logged.
    cost = _safe_cost(model, in_tok, out_tok)
    outcome = "error" if err is not None else "ok"
    if err is not None:
        logger.warning(
            "stream errored mid-stream after %d chars (model=%s purpose=%s): %s",
            len(full_text), model, purpose, err,
        )
    record_llm_call(
        user_id=user_id, tier=tier, purpose=purpose,
        prompt_slug=prompt_slug, prompt_version=prompt_version,
        model=model, input_tokens=in_tok, output_tokens=out_tok,
        cost_usd=cost, latency_ms=latency_ms,
        outcome=outcome, correlation_id=correlation_id, row_id=call_id,
    )

    yield GatewayStreamEvent(
        kind="final", text=full_text,
        result=GatewayResultLike(
            text=full_text, model=model,
            input_tokens=in_tok, output_tokens=out_tok,
            cost_usd=cost, outcome=outcome, latency_ms=latency_ms,
            llm_call_id=call_id,
        ),
    )


__all__ = ["GatewayStreamEvent", "GatewayResultLike", "stream_complete_sync"]
