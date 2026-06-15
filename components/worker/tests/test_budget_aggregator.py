"""Integration coverage for the REAL ``_aggregate_tier_spend`` path (story 1.4
code review).

``tests/llm/conftest.py`` stubs the aggregator everywhere inside the
``tests/llm/`` package, so a refactor of the SQL query, the ``Decimal``
conversion path, or the ``outcome="ok"`` filter would otherwise never be
caught. This test runs the genuine SQLAlchemy + lazy-import path against
a throwaway sqlite database, mirroring the story-1.1 ``test_prompt_pin_db.py``
pattern (lives OUTSIDE the stubbing package on purpose).
"""
from __future__ import annotations

import sys
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import pytest


@pytest.fixture
def sqlite_db_sync(monkeypatch, tmp_path: Path):
    """Fresh app.db_sync module bound to a throwaway sqlite file."""
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'budget.db'}")
    saved = sys.modules.pop("app.db_sync", None)
    import app.db_sync as db_sync  # re-imports against the sqlite URL

    yield db_sync

    sys.modules.pop("app.db_sync", None)
    if saved is not None:
        sys.modules["app.db_sync"] = saved


def _seed_llm_call(s, *, tier: str, cost: str, outcome: str = "ok",
                   created_at: datetime | None = None) -> None:
    from aimusic_shared.models import LlmCall
    s.add(LlmCall(
        id=f"llm_{uuid.uuid4().hex[:20]}",
        user_id=None,
        tier=tier,
        purpose="specialist",
        prompt_slug="low_end",
        prompt_version="1.0.0",
        model="claude-sonnet-4-5",
        input_tokens=100,
        output_tokens=50,
        cost_usd=Decimal(cost),
        price_table_version="2026-06-13",
        latency_ms=100,
        outcome=outcome,
        correlation_id="aid",
        created_at=created_at or datetime.now(tz=timezone.utc),
    ))


def test_aggregate_tier_spend_sums_current_month_ok_rows_only(sqlite_db_sync):
    from aimusic_shared.models import LlmCall

    from app.llm import budget

    LlmCall.__table__.create(sqlite_db_sync.engine)

    now = datetime.now(tz=timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    with sqlite_db_sync.SessionFactory.begin() as s:
        _seed_llm_call(s, tier="free", cost="1.50")
        _seed_llm_call(s, tier="free", cost="2.25")
        # Error row — story 1.3 contract writes cost=0 anyway, but the
        # ``outcome="ok"`` filter is explicit defense in depth.
        _seed_llm_call(s, tier="free", cost="99.00", outcome="error")
        _seed_llm_call(s, tier="pro", cost="10.00")  # different tier, ignored
        # Previous-month row — outside the rolling window.
        prev_month = month_start - timedelta(days=5)
        _seed_llm_call(s, tier="free", cost="500.00", created_at=prev_month)

    total = budget._aggregate_tier_spend("free")
    assert total == Decimal("3.75"), f"expected Decimal('3.75'), got {total!r}"
    assert isinstance(total, Decimal), "aggregator must return Decimal, not float"


def test_aggregate_tier_spend_empty_table_returns_zero(sqlite_db_sync):
    from aimusic_shared.models import LlmCall

    from app.llm import budget

    LlmCall.__table__.create(sqlite_db_sync.engine)
    total = budget._aggregate_tier_spend("free")
    assert total == Decimal("0")


def test_aggregate_global_sums_across_every_tier(sqlite_db_sync):
    from aimusic_shared.models import LlmCall

    from app.llm import budget

    LlmCall.__table__.create(sqlite_db_sync.engine)
    with sqlite_db_sync.SessionFactory.begin() as s:
        _seed_llm_call(s, tier="free", cost="1.00")
        _seed_llm_call(s, tier="pro", cost="2.50")
        _seed_llm_call(s, tier="enterprise", cost="0.50")

    total = budget._aggregate_tier_spend("free", include_all_tiers=True)
    assert total == Decimal("4.00")


def test_aggregate_returns_zero_on_db_failure(monkeypatch):
    """Fail-open: a sick metering DB returns $0 spent so paying customers
    aren't blocked on metering-infra failure."""
    from app.llm import budget

    def _explode(_tier, *, include_all_tiers=False):
        # Simulate the lazy import succeeding but the session raising.
        raise RuntimeError("DB down")

    # We can't easily stub the inner try/except, so simulate by directly
    # forcing the helper into the except branch via a poisoned dependency.
    # Easier: temporarily make ``app.db_sync`` import fail at module load.
    import sys
    saved = sys.modules.pop("app.db_sync", None)
    monkeypatch.setenv("DATABASE_URL", "")  # forces ``_sync_url`` to raise
    try:
        total = budget._aggregate_tier_spend("free")
        assert total == Decimal("0")
    finally:
        if saved is not None:
            sys.modules["app.db_sync"] = saved
