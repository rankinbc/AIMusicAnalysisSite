"""The LLM gateway — the single Anthropic touchpoint in the new stack (D1).

This is the ONLY module permitted to ``import anthropic`` (AR39, enforced by
``components/worker/tests/test_enforcement_lints.py``). Everything LLM flows
through :func:`complete` / :func:`complete_sync`:

* concurrency-limited (AR6: global semaphore + coach sub-pool),
* metered (AC3: exactly one ``llm_calls`` row per call, every outcome),
* priced (versioned table → ``cost_usd`` Decimal),
* retried under an explicit policy with model fallback (AC5/AC6),
* fakeable (AR41: ``LLM_FAKE=1`` → canned replay, zero spend).

Budget ceilings + circuit breaker (``LlmBudgetExceeded``) are story 1.4 — the
pre-call seam is marked below; do not implement budgets here.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

import anthropic

from aimusic_shared.verdicts.ulid_helpers import new_llm_call_id

from .fake import fake_response_text
from .pricing import PRICE_TABLE_VERSION, compute_cost_usd
from .settings import get_llm_settings

logger = logging.getLogger(__name__)

# Tunable backoff base (seconds). Tests monkeypatch to 0 for speed.
_RETRY_BASE_S = 0.5

_FAKE_MODEL = "fake"


# ── exceptions ──────────────────────────────────────────────────────────────

class LlmError(RuntimeError):
    """Base for all gateway errors."""


class LlmTimeoutError(LlmError):
    """Call timed out — retryable."""


class LlmRateLimitError(LlmError):
    """Provider rate limit — retryable."""


class LlmServerError(LlmError):
    """Provider 5xx / connection error — retryable."""


class LlmInvocationError(LlmError):
    """Non-retryable provider error (4xx, auth, bad request) or retry
    exhaustion."""


_RETRYABLE = (LlmTimeoutError, LlmRateLimitError, LlmServerError)


# ── result ──────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class GatewayResult:
    text: str
    model: str
    input_tokens: int
    output_tokens: int
    cost_usd: Decimal
    outcome: str  # "ok" | "error"
    latency_ms: int


# ── anthropic client (lazy, cached) ─────────────────────────────────────────

_client: anthropic.AsyncAnthropic | None = None


def _get_client() -> anthropic.AsyncAnthropic:
    """Lazily build the async SDK client. ``max_retries=0`` — the gateway owns
    the retry policy (AC6), not the SDK."""
    global _client
    if _client is None:
        settings = get_llm_settings()
        _client = anthropic.AsyncAnthropic(
            api_key=settings.anthropic_api_key, max_retries=0
        )
    return _client


def reset_client_cache() -> None:
    """Test helper — drop the cached client."""
    global _client
    _client = None


# ── per-event-loop semaphores (AR6) ─────────────────────────────────────────

_sem_state: tuple[int, asyncio.Semaphore, asyncio.Semaphore] | None = None


def _semaphores() -> tuple[asyncio.Semaphore, asyncio.Semaphore]:
    """Return ``(global_sem, coach_sem)`` bound to the running loop.

    ``complete_sync`` runs each call in a fresh ``asyncio.run`` loop, so a
    module-global semaphore would bind to a dead loop. Key the cache on the
    running loop's id and rebuild when it changes; within one loop (the async
    batch/coach paths and the concurrency tests) the semaphores are shared.
    """
    global _sem_state
    loop_id = id(asyncio.get_running_loop())
    settings = get_llm_settings()
    if _sem_state is None or _sem_state[0] != loop_id:
        _sem_state = (
            loop_id,
            asyncio.Semaphore(settings.llm_max_concurrency),
            asyncio.Semaphore(settings.llm_coach_concurrency),
        )
    return _sem_state[1], _sem_state[2]


def reset_semaphore_cache() -> None:
    """Test helper — force semaphore rebuild."""
    global _sem_state
    _sem_state = None


# ── metering (AC3) — lazy DB import, fail-open ──────────────────────────────

def record_llm_call(
    *,
    user_id: Any | None,
    tier: str | None,
    purpose: str,
    prompt_slug: str | None,
    prompt_version: str | None,
    model: str,
    input_tokens: int,
    output_tokens: int,
    cost_usd: Decimal,
    latency_ms: int,
    outcome: str,
    correlation_id: str | None,
) -> None:
    """Write one ``llm_calls`` row. Best-effort: a metering failure is logged
    and swallowed — the call already happened, so it must still be observable
    in logs but must never mask the result or fail a job.

    DB import is lazy (``app.db_sync`` raises without ``DATABASE_URL``) so unit
    tests stay DB-free by stubbing this function.
    """
    try:
        from app.db_sync import SessionFactory  # noqa: PLC0415 — deliberate lazy import
        from aimusic_shared.models import LlmCall

        row = LlmCall(
            id=new_llm_call_id(),
            user_id=user_id,
            tier=tier,
            purpose=purpose,
            prompt_slug=prompt_slug,
            prompt_version=prompt_version,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=cost_usd,
            price_table_version=PRICE_TABLE_VERSION,
            latency_ms=latency_ms,
            outcome=outcome,
            correlation_id=correlation_id,
        )
        with SessionFactory.begin() as s:
            s.add(row)
    except Exception:
        logger.exception(
            "metering write failed (purpose=%s slug=%s outcome=%s) — continuing",
            purpose, prompt_slug, outcome,
        )


# ── SDK call boundary: translate anthropic errors → gateway errors ──────────

def _extract_text(message: Any) -> str:
    return "".join(
        getattr(b, "text", "") for b in message.content
        if getattr(b, "type", None) == "text"
    )


async def _call_once(
    *, model: str, system: str, user: str, max_tokens: int, timeout_s: int
) -> tuple[str, int, int]:
    """One SDK call. Returns ``(text, input_tokens, output_tokens)``.
    Translates anthropic exceptions into gateway exceptions (retryable vs not).
    """
    client = _get_client()
    try:
        msg = await client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
            timeout=float(timeout_s),
        )
    except (anthropic.APITimeoutError, anthropic.APIConnectionError) as e:
        raise LlmTimeoutError(str(e)) from e
    except anthropic.RateLimitError as e:
        raise LlmRateLimitError(str(e)) from e
    except anthropic.InternalServerError as e:
        raise LlmServerError(str(e)) from e
    except anthropic.APIStatusError as e:
        # 4xx (bad request, auth, not found, …) — non-retryable.
        raise LlmInvocationError(str(e)) from e
    return _extract_text(msg), msg.usage.input_tokens, msg.usage.output_tokens


# ── public API ──────────────────────────────────────────────────────────────

async def complete(
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
) -> GatewayResult:
    """Run one metered LLM call. Records exactly one ``llm_calls`` row on every
    return path (success, fake, error). Raises :class:`LlmInvocationError` on
    retry exhaustion or a non-retryable provider error.
    """
    settings = get_llm_settings()
    timeout_s = timeout_s or settings.llm_timeout_s
    effective_tier = tier or settings.llm_default_tier

    # story 1.4 — budget check hook: pre-call ceiling/circuit-breaker check
    # raising LlmBudgetExceeded goes HERE, before any spend.

    if settings.llm_fake:
        return _fake_result(
            purpose=purpose, prompt_slug=prompt_slug, prompt_version=prompt_version,
            user_id=user_id, tier=effective_tier, correlation_id=correlation_id,
        )

    primary = model or settings.llm_default_model
    models_to_try = [primary]
    if settings.llm_fallback_model and settings.llm_fallback_model != primary:
        models_to_try.append(settings.llm_fallback_model)

    g_sem, c_sem = _semaphores()
    t0 = time.monotonic()
    last_exc: Exception | None = None
    last_model = primary

    async with _acquire(g_sem, c_sem, purpose):
        for attempt_model in models_to_try:
            last_model = attempt_model
            for retry in range(settings.llm_max_retries + 1):
                try:
                    text, in_tok, out_tok = await _call_once(
                        model=attempt_model, system=system, user=user,
                        max_tokens=max_tokens, timeout_s=timeout_s,
                    )
                except _RETRYABLE as e:
                    last_exc = e
                    if retry < settings.llm_max_retries:
                        await asyncio.sleep(_RETRY_BASE_S * (2 ** retry))
                        continue
                    break  # exhausted retries for this model → try fallback
                except LlmInvocationError as e:
                    last_exc = e
                    break  # non-retryable for this model → try fallback
                # success
                latency_ms = int((time.monotonic() - t0) * 1000)
                cost = compute_cost_usd(attempt_model, in_tok, out_tok)
                record_llm_call(
                    user_id=user_id, tier=effective_tier, purpose=purpose,
                    prompt_slug=prompt_slug, prompt_version=prompt_version,
                    model=attempt_model, input_tokens=in_tok, output_tokens=out_tok,
                    cost_usd=cost, latency_ms=latency_ms, outcome="ok",
                    correlation_id=correlation_id,
                )
                return GatewayResult(
                    text=text, model=attempt_model, input_tokens=in_tok,
                    output_tokens=out_tok, cost_usd=cost, outcome="ok",
                    latency_ms=latency_ms,
                )

    # all models + retries exhausted → one error row, then raise
    latency_ms = int((time.monotonic() - t0) * 1000)
    record_llm_call(
        user_id=user_id, tier=effective_tier, purpose=purpose,
        prompt_slug=prompt_slug, prompt_version=prompt_version,
        model=last_model, input_tokens=0, output_tokens=0, cost_usd=Decimal("0"),
        latency_ms=latency_ms, outcome="error", correlation_id=correlation_id,
    )
    raise LlmInvocationError(
        f"LLM call failed after retries/fallback (purpose={purpose} "
        f"slug={prompt_slug}): {last_exc}"
    ) from last_exc


def _acquire(g_sem: asyncio.Semaphore, c_sem: asyncio.Semaphore, purpose: str):
    """Weighted acquisition: coach takes its sub-pool slot THEN a global slot;
    other purposes take only a global slot (AR6)."""
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def _ctx():
        if purpose == "coach":
            async with c_sem, g_sem:
                yield
        else:
            async with g_sem:
                yield

    return _ctx()


def _fake_result(
    *, purpose: str, prompt_slug: str | None, prompt_version: str | None,
    user_id: Any | None, tier: str | None, correlation_id: str | None,
) -> GatewayResult:
    text = fake_response_text(purpose=purpose, prompt_slug=prompt_slug)
    in_tok, out_tok = 0, len(text) // 4
    record_llm_call(
        user_id=user_id, tier=tier, purpose=purpose, prompt_slug=prompt_slug,
        prompt_version=prompt_version, model=_FAKE_MODEL, input_tokens=in_tok,
        output_tokens=out_tok, cost_usd=Decimal("0"), latency_ms=0,
        outcome="ok", correlation_id=correlation_id,
    )
    return GatewayResult(
        text=text, model=_FAKE_MODEL, input_tokens=in_tok, output_tokens=out_tok,
        cost_usd=Decimal("0"), outcome="ok", latency_ms=0,
    )


def complete_sync(**kwargs: Any) -> GatewayResult:
    """Synchronous wrapper for dramatiq actors (sync ``def``). Runs the async
    core in a fresh event loop per call."""
    return asyncio.run(complete(**kwargs))
