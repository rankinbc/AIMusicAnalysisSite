"""Story 2.6 / AR35 — the SPEND guard's per-tier ceilings are operator-tunable via
feature_flags (the worker half of the two-guard model).

Lives OUTSIDE tests/llm so the autouse ``_ceiling_override → None`` stub there does
NOT apply — here we exercise the real override resolution. The feature_flags read
itself is stubbed (``_ceiling_override``) so no DB is needed.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.llm import budget
from app.llm.settings import LlmSettings

_ENV = dict(
    llm_fake=False,
    llm_default_tier="free",
    llm_budget_free_usd=Decimal("5.00"),
    llm_budget_pro_usd=Decimal("100.00"),
    llm_budget_global_usd=Decimal("1000.00"),
    llm_circuit_breaker_threshold=5,
    llm_circuit_breaker_cooldown_s=300,
)


@pytest.fixture(autouse=True)
def _reset():
    budget.reset_breaker_state()
    yield
    budget.reset_breaker_state()


def _settings(**over) -> LlmSettings:
    return LlmSettings(**{**_ENV, **over})


def test_tier_ceiling_uses_flag_override_when_present(monkeypatch):
    monkeypatch.setattr(budget, "_ceiling_override",
                        lambda name: Decimal("7.50") if name == "llm_budget_pro_usd" else None)
    s = _settings()
    assert budget._tier_ceiling("pro", s) == Decimal("7.50")   # override wins
    assert budget._tier_ceiling("free", s) == Decimal("5.00")  # no override → env


def test_tier_ceiling_falls_back_to_env_when_no_flag(monkeypatch):
    monkeypatch.setattr(budget, "_ceiling_override", lambda name: None)
    s = _settings()
    assert budget._tier_ceiling("free", s) == Decimal("5.00")
    assert budget._tier_ceiling("pro", s) == Decimal("100.00")
    assert budget._global_ceiling(s) == Decimal("1000.00")


def test_zero_override_hard_stops_a_tier(monkeypatch):
    # A flag value of 0 must be honored (None-check, not truthiness) so an
    # operator can hard-stop a tier live.
    monkeypatch.setattr(budget, "_ceiling_override",
                        lambda name: Decimal("0") if name == "llm_budget_free_usd" else None)
    assert budget._tier_ceiling("free", _settings()) == Decimal("0")


def test_check_budget_refuses_when_spend_hits_flag_overridden_ceiling(monkeypatch):
    # Env ceiling is $100 for pro, but the operator lowered it to $1 via the flag.
    monkeypatch.setattr(budget, "get_llm_settings", lambda: _settings())
    monkeypatch.setattr(budget, "_aggregate_tier_spend",
                        lambda tier, *, include_all_tiers=False: Decimal("2.00"))
    monkeypatch.setattr(budget, "_ceiling_override",
                        lambda name: Decimal("1.00") if name == "llm_budget_pro_usd" else None)

    with pytest.raises(budget.LlmBudgetExceeded):
        budget.check_budget(tier="pro", purpose="coach", user_id=None)


def test_check_budget_passes_under_flag_overridden_ceiling(monkeypatch):
    # Operator raised pro ceiling to $500; spend $200 → allowed (would also pass
    # under the $100 env default, but this proves the override is consulted).
    monkeypatch.setattr(budget, "get_llm_settings", lambda: _settings())
    monkeypatch.setattr(budget, "_aggregate_tier_spend",
                        lambda tier, *, include_all_tiers=False: Decimal("200.00"))

    def _ov(name):
        if name == "llm_budget_pro_usd":
            return Decimal("500.00")
        if name == "llm_budget_global_usd":
            return Decimal("100000.00")
        return None

    monkeypatch.setattr(budget, "_ceiling_override", _ov)
    budget.check_budget(tier="pro", purpose="coach", user_id=None)  # no raise
