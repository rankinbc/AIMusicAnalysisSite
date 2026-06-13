from __future__ import annotations

import asyncio
from decimal import Decimal

import httpx
import pytest

from app.llm import gateway
from app.llm.gateway import GatewayResult, LlmInvocationError, LlmTimeoutError

from .conftest import FakeMessage, install_fake_client


def _run(coro):
    return asyncio.run(coro)


def test_success_writes_one_ok_row(configure, metered, monkeypatch):
    configure()
    msgs = install_fake_client(monkeypatch, lambda n, kw: FakeMessage("hello", 100, 50))
    result: GatewayResult = _run(gateway.complete(
        system="sys", user="hi", purpose="specialist", prompt_slug="low_end",
        prompt_version="1.0.0",
    ))
    assert result.text == "hello"
    assert result.outcome == "ok"
    assert result.model == "claude-sonnet-4-5"
    assert result.input_tokens == 100 and result.output_tokens == 50
    assert result.cost_usd > Decimal("0")
    assert len(msgs.calls) == 1
    assert len(metered) == 1
    assert metered[0]["outcome"] == "ok"
    assert metered[0]["purpose"] == "specialist"
    assert metered[0]["prompt_slug"] == "low_end"


def test_retryable_then_success(configure, metered, monkeypatch):
    configure(llm_max_retries=2)

    def responder(n, kw):
        if n == 1:
            return LlmTimeoutError("transient")
        return FakeMessage("recovered")

    msgs = install_fake_client(monkeypatch, responder)
    result = _run(gateway.complete(system="s", user="u", purpose="specialist"))
    assert result.text == "recovered"
    assert len(msgs.calls) == 2
    assert len(metered) == 1  # exactly one row per logical call
    assert metered[0]["outcome"] == "ok"


def test_fallback_model_after_primary_exhausted(configure, metered, monkeypatch):
    configure(llm_max_retries=1, llm_default_model="claude-sonnet-4-5",
              llm_fallback_model="claude-haiku-4-5")

    def responder(n, kw):
        if kw["model"] == "claude-sonnet-4-5":
            return LlmTimeoutError("primary down")
        return FakeMessage("from fallback")

    msgs = install_fake_client(monkeypatch, responder)
    result = _run(gateway.complete(system="s", user="u", purpose="specialist"))
    assert result.text == "from fallback"
    assert result.model == "claude-haiku-4-5"
    # primary: 1 + 1 retry = 2 calls; fallback: 1 success = 1 → 3 total
    assert len(msgs.calls) == 3
    assert len(metered) == 1
    assert metered[0]["model"] == "claude-haiku-4-5"


def test_all_exhausted_writes_one_error_row(configure, metered, monkeypatch):
    configure(llm_max_retries=1)
    install_fake_client(monkeypatch, lambda n, kw: LlmTimeoutError("always down"))
    with pytest.raises(LlmInvocationError):
        _run(gateway.complete(system="s", user="u", purpose="triage",
                              prompt_slug="triage"))
    assert len(metered) == 1
    assert metered[0]["outcome"] == "error"
    assert metered[0]["input_tokens"] == 0
    assert metered[0]["cost_usd"] == Decimal("0")


def test_non_retryable_fails_without_retry(configure, metered, monkeypatch):
    configure(llm_max_retries=3, llm_default_model="m1", llm_fallback_model="m1")

    def responder(n, kw):
        return LlmInvocationError("bad request")

    msgs = install_fake_client(monkeypatch, responder)
    with pytest.raises(LlmInvocationError):
        _run(gateway.complete(system="s", user="u", purpose="specialist"))
    # No fallback (equals primary), no transport retry on non-retryable → 1 call.
    assert len(msgs.calls) == 1
    assert len(metered) == 1
    assert metered[0]["outcome"] == "error"


def test_anthropic_timeout_is_translated_and_retried(configure, metered, monkeypatch):
    configure(llm_max_retries=1)
    req = httpx.Request("POST", "https://api.anthropic.com/v1/messages")

    def responder(n, kw):
        if n == 1:
            return gateway.anthropic.APITimeoutError(request=req)
        return FakeMessage("ok after sdk timeout")

    install_fake_client(monkeypatch, responder)
    result = _run(gateway.complete(system="s", user="u", purpose="specialist"))
    assert result.text == "ok after sdk timeout"
    assert metered[0]["outcome"] == "ok"


def test_fake_mode_no_sdk_zero_cost(configure, metered, monkeypatch):
    configure(llm_fake=True)

    def _boom():
        raise AssertionError("SDK client must not be constructed in fake mode")

    monkeypatch.setattr(gateway, "_get_client", _boom)
    result = _run(gateway.complete(system="s", user="u", purpose="specialist",
                                   prompt_slug="low_end"))
    assert result.model == "fake"
    assert result.cost_usd == Decimal("0")
    assert len(metered) == 1
    assert metered[0]["outcome"] == "ok"
    # canned response is valid JSON with a verdicts array
    import json
    assert "verdicts" in json.loads(result.text)


def test_complete_sync_wraps_async(configure, metered, monkeypatch):
    configure()
    install_fake_client(monkeypatch, lambda n, kw: FakeMessage("sync path"))
    result = gateway.complete_sync(system="s", user="u", purpose="specialist")
    assert result.text == "sync path"
    assert len(metered) == 1
