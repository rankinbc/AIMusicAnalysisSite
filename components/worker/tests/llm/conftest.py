"""Shared fixtures for gateway tests — keep them network-free and DB-free.

No ``anthropic`` import here (AR39). The SDK is stubbed by monkeypatching
``gateway._get_client``; metering is stubbed by capturing rows in a list.
"""
from __future__ import annotations

import pytest

from app.llm import gateway
from app.llm.settings import LlmSettings

_DEFAULTS = dict(
    anthropic_api_key="test-key",
    llm_max_concurrency=5,
    llm_coach_concurrency=2,
    llm_fake=False,
    llm_default_model="claude-sonnet-4-5",
    llm_fallback_model="claude-haiku-4-5",
    llm_max_retries=2,
    llm_timeout_s=120,
    llm_default_tier="free",
)


@pytest.fixture
def metered(monkeypatch):
    """Capture every metering row instead of writing to the DB."""
    rows: list[dict] = []
    monkeypatch.setattr(gateway, "record_llm_call", lambda **kw: rows.append(kw))
    return rows


@pytest.fixture
def configure(monkeypatch):
    """Override LLM settings + zero the retry backoff. Returns a setter."""
    monkeypatch.setattr(gateway, "_RETRY_BASE_S", 0.0)

    def _set(**overrides) -> LlmSettings:
        merged = {**_DEFAULTS, **overrides}
        settings = LlmSettings(**merged)
        monkeypatch.setattr(gateway, "get_llm_settings", lambda: settings)
        gateway.reset_semaphore_cache()
        gateway.reset_client_cache()
        return settings

    return _set


class FakeMessage:
    """Mimics an anthropic Messages response."""

    def __init__(self, text: str, input_tokens: int = 10, output_tokens: int = 20):
        block = type("Block", (), {"type": "text", "text": text})()
        self.content = [block]
        self.usage = type("Usage", (), {
            "input_tokens": input_tokens, "output_tokens": output_tokens,
        })()


def install_fake_client(monkeypatch, responder):
    """Wire ``gateway._get_client`` to a fake whose ``messages.create`` calls
    ``responder(call_index, kwargs)`` → returns a FakeMessage or raises.
    Returns the ``messages`` stub so tests can inspect ``.calls``.
    """
    class _Messages:
        def __init__(self):
            self.calls: list[dict] = []

        async def create(self, **kw):
            self.calls.append(kw)
            result = responder(len(self.calls), kw)
            if isinstance(result, Exception):
                raise result
            return result

    class _Client:
        def __init__(self):
            self.messages = _Messages()

    client = _Client()
    monkeypatch.setattr(gateway, "_get_client", lambda: client)
    return client.messages
