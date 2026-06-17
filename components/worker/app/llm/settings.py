"""LLM gateway configuration (pydantic-settings, env-sourced).

No ``anthropic`` import here (AR39). Secrets via env only (NFR6).
"""
from __future__ import annotations

from decimal import Decimal
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class LlmSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", extra="ignore", case_sensitive=False)

    # Secret — env only, never defaulted to a real value (NFR6).
    anthropic_api_key: str | None = None

    # Concurrency (AR6). Global pool + a coach sub-pool that also draws from
    # the global pool (weighted acquisition) so coach can't starve verdicts.
    llm_max_concurrency: int = 5
    llm_coach_concurrency: int = 2

    # Fake replay (AR41) — no network, no spend. Truthy via env "1"/"true".
    llm_fake: bool = False

    # ── DEV-ONLY temporary escape hatch ────────────────────────────────────
    # Route LLM calls through the local `claude` CLI subprocess (subscription
    # auth) instead of the SDK/API key. Ported from the v1 `CliClient` purely
    # so a developer can eyeball real specialist output locally without an API
    # key. Token counts/cost are unavailable from the CLI → metered as 0.
    # NOT for production: the SDK + API-key path is the shipping design (the
    # whole metering/budget system depends on real token counts). Takes
    # precedence over llm_fake when both are set.
    use_claude_cli: bool = False

    # Models (NFR24). Operator MUST confirm the exact API model id for their
    # account; these are sensible families and are overridable via env.
    llm_default_model: str = "claude-sonnet-4-5"
    llm_fallback_model: str = "claude-haiku-4-5"

    # Retry policy (AC6) — gateway owns retries; SDK max_retries is set to 0.
    llm_max_retries: int = 2
    llm_timeout_s: int = 120

    # Default tier stamped on metering rows until Epic 2 billing stamps the
    # job row with the real tier.
    llm_default_tier: str = "free"

    # ── Story 1.4: budgets + circuit breaker (AR8 / FR16) ──────────────────
    # Per-tier monthly USD ceilings — Decimal not float (money). Tier strings
    # mirror LlmCall.tier values: "free" (default until Epic 2 stamps real
    # tier), "pro" (Epic 2). Unknown tier falls back to the global ceiling.
    llm_budget_free_usd: Decimal = Decimal("5.00")
    llm_budget_pro_usd: Decimal = Decimal("100.00")
    # Operator hard cap across all tiers in a calendar month.
    llm_budget_global_usd: Decimal = Decimal("1000.00")

    # Provider-outage circuit breaker (per-process; workers run concurrency=1).
    # Opens after N consecutive error outcomes; stays open for the cooldown
    # window. Next call after cooldown is a "probe" — closes on success,
    # re-opens on failure. Automatic recovery (AC4) — no manual reset.
    llm_circuit_breaker_threshold: int = 5
    llm_circuit_breaker_cooldown_s: int = 300

    def tier_ceiling(self, tier: str | None) -> Decimal:
        """Resolve the monthly USD ceiling for a tier. Unknown / None →
        global cap (operators get a defended hard floor).
        """
        if tier == "free":
            return self.llm_budget_free_usd
        if tier == "pro":
            return self.llm_budget_pro_usd
        return self.llm_budget_global_usd


@lru_cache(maxsize=1)
def get_llm_settings() -> LlmSettings:
    return LlmSettings()


def reset_llm_settings_cache() -> None:
    """Test helper — drop the cached settings so env overrides take effect."""
    get_llm_settings.cache_clear()
