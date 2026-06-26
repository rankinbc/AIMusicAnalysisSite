"""Tests for the budget guard + circuit breaker (story 1.4 / AR8).

All scenarios are DB-free: ``_aggregate_tier_spend`` is stubbed by the
autouse fixture in ``conftest.py`` and overridden per-test for budget
scenarios. The breaker state resets between every test.
"""
from __future__ import annotations

import time
from decimal import Decimal

import pytest

from app.llm import budget
from app.llm.gateway import (
    DEGRADATION_REASON_CIRCUIT_BREAKER,
    DEGRADATION_REASON_GLOBAL_BUDGET,
    DEGRADATION_REASON_TIER_BUDGET,
    LlmBudgetExceeded,
)


# ── tier_ceiling resolution ─────────────────────────────────────────────────

def test_tier_ceiling_known_tiers(configure):
    settings = configure(
        llm_budget_free_usd=Decimal("5.00"),
        llm_budget_pro_usd=Decimal("100.00"),
        llm_budget_global_usd=Decimal("1000.00"),
    )
    assert settings.tier_ceiling("free") == Decimal("5.00")
    assert settings.tier_ceiling("pro") == Decimal("100.00")


def test_tier_ceiling_unknown_falls_back_to_global(configure):
    settings = configure(
        llm_budget_free_usd=Decimal("5.00"),
        llm_budget_global_usd=Decimal("250.00"),
    )
    # Unknown / None → operator hard cap.
    assert settings.tier_ceiling("enterprise") == Decimal("250.00")
    assert settings.tier_ceiling(None) == Decimal("250.00")


# ── budget guard ────────────────────────────────────────────────────────────

def test_check_budget_under_ceiling_returns_silently(configure, monkeypatch):
    configure(llm_budget_free_usd=Decimal("5.00"))
    monkeypatch.setattr(
        budget, "_aggregate_tier_spend",
        lambda tier, *, include_all_tiers=False: Decimal("3.00"),
    )
    # No raise → guard returned silently.
    budget.check_budget(tier="free", purpose="specialist", user_id=None)


def test_check_budget_at_tier_ceiling_raises_tier_budget(configure, monkeypatch):
    configure(llm_budget_free_usd=Decimal("5.00"))
    monkeypatch.setattr(
        budget, "_aggregate_tier_spend",
        lambda tier, *, include_all_tiers=False: Decimal("5.00"),
    )
    with pytest.raises(LlmBudgetExceeded) as exc:
        budget.check_budget(tier="free", purpose="specialist", user_id=None)
    assert exc.value.reason == DEGRADATION_REASON_TIER_BUDGET
    assert "tier=free" in str(exc.value)


def test_check_budget_over_tier_ceiling_raises(configure, monkeypatch):
    configure(llm_budget_free_usd=Decimal("5.00"))
    monkeypatch.setattr(
        budget, "_aggregate_tier_spend",
        lambda tier, *, include_all_tiers=False: Decimal("5.12"),
    )
    with pytest.raises(LlmBudgetExceeded) as exc:
        budget.check_budget(tier="free", purpose="specialist", user_id=None)
    assert exc.value.reason == DEGRADATION_REASON_TIER_BUDGET


def test_global_cap_independent_of_tier_cap(configure, monkeypatch):
    """Tier cap healthy but global cap blown → global_budget reason."""
    configure(
        llm_budget_free_usd=Decimal("1000.00"),  # tier wide open
        llm_budget_global_usd=Decimal("50.00"),  # global tight
    )
    def _spend(tier, *, include_all_tiers=False):
        return Decimal("50.00") if include_all_tiers else Decimal("0.00")
    monkeypatch.setattr(budget, "_aggregate_tier_spend", _spend)

    with pytest.raises(LlmBudgetExceeded) as exc:
        budget.check_budget(tier="free", purpose="triage", user_id=None)
    assert exc.value.reason == DEGRADATION_REASON_GLOBAL_BUDGET


def test_llm_fake_mode_bypasses_all_guards(configure, monkeypatch):
    """LLM_FAKE=1 must short-circuit — dev/CI never sees degraded reports
    unless a test sets up the scenario explicitly."""
    configure(llm_fake=True, llm_budget_free_usd=Decimal("0.01"))
    monkeypatch.setattr(
        budget, "_aggregate_tier_spend",
        lambda tier, *, include_all_tiers=False: Decimal("99999.00"),
    )
    # Also poison the breaker — fake mode shouldn't care.
    budget._breaker.opened_at = time.monotonic()
    budget._breaker.consecutive_errors = 999

    budget.check_budget(tier="free", purpose="specialist", user_id=None)


def test_spend_aggregation_failure_fails_open(configure, monkeypatch):
    """A sick metering DB returns $0 spent → guard lets the call through.
    The breaker still defends against actual provider outages.
    """
    configure(llm_budget_free_usd=Decimal("5.00"))
    # autouse fixture already stubs to Decimal("0"); just confirm guard passes.
    budget.check_budget(tier="free", purpose="specialist", user_id=None)


def test_claude_cli_mode_bypasses_spend_ceilings(configure, monkeypatch):
    """CLI transport (Claude subscription) has no metered per-call API spend, so
    the USD ceilings must NOT apply — enforcing them would wrongly degrade
    analyses (reason=tier_budget) and take the coach offline."""
    configure(use_claude_cli=True, llm_budget_free_usd=Decimal("5.00"))
    # Spend is way over the ceiling — would raise in API mode.
    monkeypatch.setattr(
        budget, "_aggregate_tier_spend",
        lambda tier, *, include_all_tiers=False: Decimal("99999.00"),
    )
    # No raise → CLI mode skipped the ceiling guards.
    budget.check_budget(tier="free", purpose="coach", user_id=None)


def test_claude_cli_mode_still_respects_circuit_breaker(configure):
    """The CLI-spend bypass must NOT disable the provider-outage breaker — a CLI
    that keeps erroring should still trip it so we don't hammer a down provider."""
    configure(use_claude_cli=True, llm_circuit_breaker_threshold=2)
    budget.record_outcome(outcome="error")
    budget.record_outcome(outcome="error")
    with pytest.raises(LlmBudgetExceeded) as exc:
        budget.check_budget(tier="free", purpose="coach", user_id=None)
    assert exc.value.reason == DEGRADATION_REASON_CIRCUIT_BREAKER


# ── circuit breaker ─────────────────────────────────────────────────────────

def test_breaker_opens_after_threshold_consecutive_errors(configure):
    configure(llm_circuit_breaker_threshold=3, llm_circuit_breaker_cooldown_s=60)
    for _ in range(3):
        budget.record_outcome(outcome="error")

    with pytest.raises(LlmBudgetExceeded) as exc:
        budget.check_budget(tier="free", purpose="specialist", user_id=None)
    assert exc.value.reason == DEGRADATION_REASON_CIRCUIT_BREAKER


def test_breaker_does_not_open_under_threshold(configure):
    configure(llm_circuit_breaker_threshold=5)
    for _ in range(4):
        budget.record_outcome(outcome="error")
    # Still under threshold → guard passes.
    budget.check_budget(tier="free", purpose="specialist", user_id=None)


def test_breaker_resets_on_success(configure):
    """A single success closes the breaker — recovery is automatic (AC4)."""
    configure(llm_circuit_breaker_threshold=3)
    for _ in range(2):
        budget.record_outcome(outcome="error")
    budget.record_outcome(outcome="ok")
    # Counter reset to zero → 2 more errors should NOT open the breaker.
    for _ in range(2):
        budget.record_outcome(outcome="error")
    budget.check_budget(tier="free", purpose="specialist", user_id=None)


def test_breaker_probe_after_cooldown_succeeds_and_closes(configure):
    """After cooldown elapses the next call is a probe; success closes the
    breaker permanently (until errors re-build to threshold)."""
    configure(llm_circuit_breaker_threshold=2, llm_circuit_breaker_cooldown_s=60)
    budget.record_outcome(outcome="error")
    budget.record_outcome(outcome="error")  # breaker opens

    # Verify open: would raise.
    with pytest.raises(LlmBudgetExceeded):
        budget.check_budget(tier="free", purpose="specialist", user_id=None)

    # Force cooldown to "elapse" by rewinding the opened_at timestamp.
    budget._breaker.opened_at = time.monotonic() - 9999

    # Probe call: guard lets it through.
    budget.check_budget(tier="free", purpose="specialist", user_id=None)
    # Simulate gateway success → breaker closes.
    budget.record_outcome(outcome="ok")
    # Next call still passes.
    budget.check_budget(tier="free", purpose="specialist", user_id=None)


def test_breaker_probe_failure_reopens_with_fresh_cooldown(configure):
    configure(llm_circuit_breaker_threshold=2, llm_circuit_breaker_cooldown_s=60)
    budget.record_outcome(outcome="error")
    budget.record_outcome(outcome="error")

    # Cooldown elapses.
    budget._breaker.opened_at = time.monotonic() - 9999
    # Probe lets the call through.
    budget.check_budget(tier="free", purpose="specialist", user_id=None)
    # Probe fails → breaker re-opens (no error-counter accumulation needed).
    budget.record_outcome(outcome="error")

    with pytest.raises(LlmBudgetExceeded) as exc:
        budget.check_budget(tier="free", purpose="specialist", user_id=None)
    assert exc.value.reason == DEGRADATION_REASON_CIRCUIT_BREAKER


def test_record_outcome_handles_unknown_outcome_strings(configure):
    """Defensive: an unexpected outcome value should not crash the breaker."""
    configure()
    budget.record_outcome(outcome="weird")
    # State unchanged from initial.
    assert budget._breaker.consecutive_errors == 0
    assert budget._breaker.opened_at is None
