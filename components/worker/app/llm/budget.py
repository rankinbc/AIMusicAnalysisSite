"""LLM budget guard + provider-outage circuit breaker (story 1.4 / AR8).

Two independent guards, both PRE-call, both raising :class:`LlmBudgetExceeded`:

1. **Monthly tier ceiling** — sum of ``cost_usd`` on ``llm_calls`` (current
   calendar month, ``outcome="ok"`` only) compared to the per-tier limit
   from :class:`LlmSettings`. A separate global ceiling defends the operator
   across all tiers.
2. **Circuit breaker** — in-process state (workers run ``concurrency=1`` per
   CLAUDE.md). Opens after ``llm_circuit_breaker_threshold`` consecutive
   ``error`` outcomes; stays open for ``llm_circuit_breaker_cooldown_s``.
   The first call after cooldown is a "probe" (bypasses the open check) — it
   closes the breaker on success or re-opens it on failure. Recovery is
   automatic (AC4): no manual reset.

No ``anthropic`` import here (AR39). DB access is lazy + fail-open
(story 1.3 ``record_llm_call`` precedent): a sick metering DB returns
"$0 spent" — meaning the call proceeds — because blocking paying customers
on metering-infrastructure failure is the wrong default. The circuit breaker
still defends against actual provider outages.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from .errors import (
    DEGRADATION_REASON_CIRCUIT_BREAKER,
    DEGRADATION_REASON_GLOBAL_BUDGET,
    DEGRADATION_REASON_TIER_BUDGET,
    LlmBudgetExceeded,
)
from .settings import get_llm_settings

logger = logging.getLogger(__name__)


# ── circuit breaker (in-process, per worker) ────────────────────────────────


@dataclass
class _BreakerState:
    consecutive_errors: int = 0
    opened_at: float | None = None   # ``time.monotonic()`` when opened
    in_probe: bool = False           # next call after cooldown bypasses the gate


_breaker = _BreakerState()


def reset_breaker_state() -> None:
    """Test helper — drop the breaker state."""
    global _breaker
    _breaker = _BreakerState()


def _breaker_open() -> bool:
    """True iff the breaker is currently rejecting calls (not in the probe
    window). Side-effect: clears ``opened_at`` and flips ``in_probe`` once
    the cooldown elapses so the next call can probe."""
    settings = get_llm_settings()
    if _breaker.opened_at is None:
        return False
    elapsed = time.monotonic() - _breaker.opened_at
    if elapsed >= settings.llm_circuit_breaker_cooldown_s:
        # Cooldown elapsed → let one call through as a probe.
        _breaker.in_probe = True
        _breaker.opened_at = None
        return False
    return True


def record_outcome(*, outcome: str) -> None:
    """Advance the breaker state after a call returns. Called by the gateway
    on every success or final-error return path (fake-mode included)."""
    if outcome == "ok":
        _breaker.consecutive_errors = 0
        _breaker.opened_at = None
        _breaker.in_probe = False
        return
    if outcome == "error":
        settings = get_llm_settings()
        _breaker.consecutive_errors += 1
        if _breaker.in_probe:
            # Probe failed → re-open with a fresh cooldown window.
            _breaker.in_probe = False
            _breaker.opened_at = time.monotonic()
            return
        if _breaker.consecutive_errors >= settings.llm_circuit_breaker_threshold:
            _breaker.opened_at = time.monotonic()


# ── monthly tier-spend aggregation (lazy DB, fail-open) ─────────────────────


def _aggregate_tier_spend(tier: str, *, include_all_tiers: bool = False) -> Decimal:
    """Sum ``cost_usd`` on ``llm_calls`` for the current calendar month.

    ``include_all_tiers=True`` → global aggregate (operator hard cap).
    Filter is ``outcome="ok"`` — error rows had no spend (story 1.3 writes
    cost=0 on error). Returns ``Decimal("0")`` on DB failure (fail-open per
    story 1.1 / 1.3 pattern).
    """
    try:
        from sqlalchemy import func, select  # noqa: PLC0415 — deliberate lazy import
        from aimusic_shared.models import LlmCall

        from app.db_sync import SessionFactory

        month_start = datetime.now(tz=timezone.utc).replace(
            day=1, hour=0, minute=0, second=0, microsecond=0,
        )
        # ``Decimal("0")`` default keeps the column type Decimal end-to-end
        # — an ``int`` default could silently cast through ``Decimal(float)``
        # downstream and break the money-rule guardrail (story 1.3).
        stmt = select(
            func.coalesce(func.sum(LlmCall.cost_usd), Decimal("0"))
        ).where(
            LlmCall.created_at >= month_start,
            LlmCall.outcome == "ok",
        )
        if not include_all_tiers:
            stmt = stmt.where(LlmCall.tier == tier)
        with SessionFactory() as s:
            value = s.execute(stmt).scalar()
        if value is None:
            return Decimal("0")
        # ``Decimal(str(value))`` defends against a stray float slipping
        # through driver translation — story 1.3 money rule.
        return value if isinstance(value, Decimal) else Decimal(str(value))
    except Exception:
        logger.exception(
            "spend aggregation failed (tier=%s include_all=%s) — fail-open at $0",
            tier, include_all_tiers,
        )
        return Decimal("0")


# ── operator-tunable ceilings (feature_flags override, story 2.6 / AR35) ─────


def _ceiling_override(flag_name: str) -> Decimal | None:
    """Operator override of a monthly USD ceiling from the ``feature_flags``
    table (hot-reloaded ~60 s — the worker half of AR35). Returns ``None`` on any
    miss/parse-failure/DB error so the caller falls back to the env default.

    Isolated in its own function so the LLM unit tests (``tests/llm``) can stub it
    to ``None`` and stay hermetically env-driven regardless of the flag cache.
    """
    from app.feature_flags import get_flag_decimal  # noqa: PLC0415 — lazy

    return get_flag_decimal(flag_name, None)


def _tier_ceiling(tier: str, settings: Any) -> Decimal:
    """Per-tier monthly ceiling: feature_flags override else env settings.
    None-check (not truthiness) so an operator can set ``0`` to hard-stop a tier."""
    if tier == "free":
        override = _ceiling_override("llm_budget_free_usd")
        return override if override is not None else settings.llm_budget_free_usd
    if tier == "pro":
        override = _ceiling_override("llm_budget_pro_usd")
        return override if override is not None else settings.llm_budget_pro_usd
    # Unknown/None tier → operator global hard floor.
    return _global_ceiling(settings)


def _global_ceiling(settings: Any) -> Decimal:
    override = _ceiling_override("llm_budget_global_usd")
    return override if override is not None else settings.llm_budget_global_usd


# ── public guard ────────────────────────────────────────────────────────────


def check_budget(*, tier: str | None, purpose: str, user_id: Any | None) -> None:
    """Pre-call guard. Raises :class:`LlmBudgetExceeded` if any of the three
    guards trips; returns silently otherwise.

    Bypasses every check in ``LLM_FAKE=1`` mode so dev/CI stays predictable
    (the fake path is no-spend by construction).
    """
    settings = get_llm_settings()
    if settings.llm_fake:
        return

    # 1. Circuit breaker (provider outage). Cheap in-process check first.
    #    Kept even in CLI mode: a CLI that keeps erroring should still trip the
    #    breaker so we don't hammer a down provider.
    if _breaker_open():
        logger.warning(
            "circuit breaker OPEN — refusing %s call (consecutive_errors=%d)",
            purpose, _breaker.consecutive_errors,
        )
        raise LlmBudgetExceeded(
            DEGRADATION_REASON_CIRCUIT_BREAKER,
            f"provider unavailable (consecutive_errors={_breaker.consecutive_errors})",
        )

    # CLI transport (Claude subscription) has NO metered per-call API spend, so
    # the USD ceilings below are meaningless against it — the gateway still
    # records a notional cost for observability, but enforcing a dollar ceiling
    # on a flat-rate subscription would wrongly degrade analyses (reason=
    # tier_budget) and take the coach offline. Skip the spend guards in CLI mode;
    # the circuit breaker above still applies.
    if settings.use_claude_cli:
        return

    # 2. Per-tier monthly ceiling (feature_flags override → env default, AR35).
    effective_tier = tier or settings.llm_default_tier
    tier_spent = _aggregate_tier_spend(effective_tier)
    tier_cap = _tier_ceiling(effective_tier, settings)
    if tier_spent >= tier_cap:
        logger.warning(
            "tier budget EXCEEDED tier=%s spent=$%s ceiling=$%s",
            effective_tier, _fmt_money(tier_spent), _fmt_money(tier_cap),
        )
        raise LlmBudgetExceeded(
            DEGRADATION_REASON_TIER_BUDGET,
            f"tier={effective_tier} spent=${_fmt_money(tier_spent)} "
            f"ceiling=${_fmt_money(tier_cap)}",
        )

    # 3. Global operator hard cap (sum across all tiers; AR35-overridable).
    global_spent = _aggregate_tier_spend(effective_tier, include_all_tiers=True)
    global_cap = _global_ceiling(settings)
    if global_spent >= global_cap:
        logger.warning(
            "global budget EXCEEDED spent=$%s ceiling=$%s",
            _fmt_money(global_spent), _fmt_money(global_cap),
        )
        raise LlmBudgetExceeded(
            DEGRADATION_REASON_GLOBAL_BUDGET,
            f"spent=${_fmt_money(global_spent)} ceiling=${_fmt_money(global_cap)}",
        )


def _fmt_money(d: Decimal) -> str:
    """Format a Decimal as 2-dp cents — keeps the operator-readable
    ``detail`` field free of internal precision noise like ``$5.0000123``."""
    return str(d.quantize(Decimal("0.01")))
