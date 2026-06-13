"""LLM gateway configuration (pydantic-settings, env-sourced).

No ``anthropic`` import here (AR39). Secrets via env only (NFR6).
"""
from __future__ import annotations

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


@lru_cache(maxsize=1)
def get_llm_settings() -> LlmSettings:
    return LlmSettings()


def reset_llm_settings_cache() -> None:
    """Test helper — drop the cached settings so env overrides take effect."""
    get_llm_settings.cache_clear()
