from __future__ import annotations

from decimal import Decimal

from app.llm.pricing import PRICE_TABLE_VERSION, compute_cost_usd


def test_known_model_cost_math():
    # sonnet-4 family: $3 / Mtok input, $15 / Mtok output.
    cost = compute_cost_usd("claude-sonnet-4-5", 1_000_000, 1_000_000)
    assert cost == Decimal("18.000000")


def test_dated_snapshot_matches_family_prefix():
    cost = compute_cost_usd("claude-sonnet-4-5-20250929", 500_000, 0)
    assert cost == Decimal("1.500000")


def test_haiku_cheaper_than_sonnet():
    haiku = compute_cost_usd("claude-haiku-4-5", 1_000_000, 1_000_000)
    sonnet = compute_cost_usd("claude-sonnet-4-5", 1_000_000, 1_000_000)
    assert haiku < sonnet


def test_unknown_model_zero(caplog):
    with caplog.at_level("WARNING"):
        cost = compute_cost_usd("gpt-9000", 1_000_000, 1_000_000)
    assert cost == Decimal("0")
    assert any("no price-table entry" in r.message for r in caplog.records)


def test_fake_model_zero():
    assert compute_cost_usd("fake", 9999, 9999) == Decimal("0")


def test_rounding_to_six_dp():
    cost = compute_cost_usd("claude-sonnet-4-5", 1, 0)
    # 1 token * $3/Mtok = 0.000003
    assert cost == Decimal("0.000003")


def test_price_table_version_is_set():
    assert PRICE_TABLE_VERSION
