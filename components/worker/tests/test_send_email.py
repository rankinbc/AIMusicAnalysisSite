"""Story 4.2 — send_email actor: stub mode, delivery, retry classification."""
from __future__ import annotations

import os

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")

from app import send_email_actor as sea  # noqa: E402

ARGS = dict(
    to="user@example.test", subject="s", html="<p>x</p>",
    template="verification", from_address="SPECTR <t@test>",
)


class _Resp:
    def __init__(self, status_code: int, text: str = ""):
        self.status_code = status_code
        self.text = text


def test_stub_mode_without_api_key(monkeypatch, caplog):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    with caplog.at_level("INFO"):
        assert sea.deliver(**ARGS) == "stubbed"
    joined = " ".join(r.message for r in caplog.records)
    assert "STUB" in joined
    assert "user@example.test" not in joined  # address masked in logs


def test_success_posts_to_resend(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_unit_fake")
    captured: dict = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        captured.update(url=url, headers=headers, json=json)
        return _Resp(200)

    import httpx
    monkeypatch.setattr(httpx, "post", fake_post)

    assert sea.deliver(**ARGS) == "sent"
    assert captured["url"] == sea.RESEND_API_URL
    assert captured["headers"]["Authorization"] == "Bearer re_unit_fake"
    assert captured["json"]["to"] == ["user@example.test"]
    assert captured["json"]["subject"] == "s"
    assert captured["json"]["from"] == "SPECTR <t@test>"


@pytest.mark.parametrize("status", [500, 503, 429])
def test_transient_failures_raise_for_retry(monkeypatch, status):
    monkeypatch.setenv("RESEND_API_KEY", "re_unit_fake")
    import httpx
    monkeypatch.setattr(httpx, "post", lambda *a, **k: _Resp(status))
    with pytest.raises(RuntimeError):
        sea.deliver(**ARGS)  # raise → dramatiq max_retries backoff


@pytest.mark.parametrize("status", [400, 403, 422])
def test_permanent_failures_swallow(monkeypatch, status):
    monkeypatch.setenv("RESEND_API_KEY", "re_unit_fake")
    import httpx
    monkeypatch.setattr(httpx, "post", lambda *a, **k: _Resp(status, "bad address"))
    assert sea.deliver(**ARGS) == "rejected"  # never spins the queue
