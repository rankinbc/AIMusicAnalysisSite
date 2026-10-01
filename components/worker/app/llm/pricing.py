"""Versioned LLM price table → per-call ``cost_usd`` (AC3).

This module is the canonical config location for LLM token prices
(architecture: "no price literals outside config" — for LLM cost, that means
HERE). No ``anthropic`` import. Money is ``Decimal``, never float.

Prices are USD per 1,000,000 tokens, sourced from public Anthropic pricing
on 2026-06-13. Bump ``PRICE_TABLE_VERSION`` whenever a rate changes so old
``llm_calls`` rows remain auditable against the table that priced them.

Prompt caching (2026-10-01): cache WRITES bill at 1.25x the input rate (5-min
TTL) and cache READS at 0.1x. ``input_tokens`` from the API counts only the
uncached tail, so all three buckets must be priced or spend is under-reported.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

logger = logging.getLogger(__name__)

PRICE_TABLE_VERSION = "2026-10-01"

# Multipliers on the model's input rate for prompt-cache tokens (5-min TTL).
CACHE_WRITE_MULTIPLIER = Decimal("1.25")
CACHE_READ_MULTIPLIER = Decimal("0.1")


@dataclass(frozen=True)
class ModelPrice:
    input_per_mtok: Decimal   # USD per 1e6 input tokens
    output_per_mtok: Decimal  # USD per 1e6 output tokens


# Keyed by model FAMILY prefix. Dated snapshots (e.g.
# "claude-sonnet-4-5-20250929") match by longest-prefix so the table need
# not enumerate every snapshot id.
MODEL_PRICES: dict[str, ModelPrice] = {
    "claude-opus-4":   ModelPrice(Decimal("15"), Decimal("75")),
    "claude-sonnet-4": ModelPrice(Decimal("3"),  Decimal("15")),
    "claude-haiku-4":  ModelPrice(Decimal("1"),  Decimal("5")),
    # Legacy 3.x families kept for any pinned-version rollbacks.
    "claude-3-5-haiku": ModelPrice(Decimal("0.80"), Decimal("4")),
    "claude-3-5-sonnet": ModelPrice(Decimal("3"), Decimal("15")),
}

_FAKE_MODEL = "fake"


def _lookup(model: str) -> ModelPrice | None:
    if model in MODEL_PRICES:
        return MODEL_PRICES[model]
    # Longest matching family prefix wins.
    best: str | None = None
    for family in MODEL_PRICES:
        if model.startswith(family) and (best is None or len(family) > len(best)):
            best = family
    return MODEL_PRICES[best] if best else None


def compute_cost_usd(
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_creation_input_tokens: int = 0,
    cache_read_input_tokens: int = 0,
) -> Decimal:
    """USD cost for one call, rounded to 6 dp. Unknown model → ``0`` + warning
    (metering must never fail a job over an unpriced model).

    ``input_tokens`` is the UNCACHED input only (the API reports cache writes
    and reads separately); the cache buckets are priced off the input rate."""
    if model == _FAKE_MODEL:
        return Decimal("0")
    price = _lookup(model)
    if price is None:
        logger.warning("no price-table entry for model %r — recording cost_usd=0", model)
        return Decimal("0")
    mtok = Decimal(1_000_000)
    cost = (
        Decimal(input_tokens) / mtok * price.input_per_mtok
        + Decimal(cache_creation_input_tokens) / mtok * price.input_per_mtok
        * CACHE_WRITE_MULTIPLIER
        + Decimal(cache_read_input_tokens) / mtok * price.input_per_mtok
        * CACHE_READ_MULTIPLIER
        + Decimal(output_tokens) / mtok * price.output_per_mtok
    )
    return cost.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
