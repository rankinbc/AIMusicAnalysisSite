"""Streaming gateway tests (story 1.6 / Task 6.3).

Sits OUTSIDE ``tests/llm/`` so the autouse fixture in
``tests/llm/conftest.py`` doesn't apply — these tests intentionally
exercise the budget guard + metering invariants and need clean state.

The real Anthropic SDK is monkeypatched away. The LLM_FAKE path is
exercised end-to-end because that's the documented dev/CI default.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.llm import gateway, streaming
from app.llm.errors import LlmBudgetExceeded
from app.llm.gateway import GatewayStreamEvent, stream_complete_sync
from app.llm.settings import reset_llm_settings_cache


@pytest.fixture(autouse=True)
def _stub_dependencies(monkeypatch):
    """Stub the metering write + budget gate so each test starts clean
    without touching the DB. The LLM_FAKE path otherwise tries to write
    one ``llm_calls`` row per call.
    """
    rows: list[dict] = []

    def fake_record(**kwargs):
        rows.append(kwargs)
        return kwargs.get("row_id") or "llm_FAKE_ROW_ID"

    monkeypatch.setattr(gateway, "record_llm_call", fake_record)
    # ``streaming._stream_real`` late-imports ``record_llm_call`` and
    # ``_safe_cost`` from gateway — both module-level attributes resolve
    # at call time, so the monkeypatch above is sufficient.

    # Budget gate: no-op + a recording ``record_outcome`` so we can
    # assert the streaming path mirrors ``complete()``'s budget semantics.
    from app.llm import budget  # noqa: PLC0415
    outcomes: list[str] = []
    monkeypatch.setattr(budget, "check_budget",
                        lambda *, tier, purpose, user_id: None)
    monkeypatch.setattr(budget, "record_outcome",
                        lambda *, outcome: outcomes.append(outcome))

    reset_llm_settings_cache()
    yield rows, outcomes
    reset_llm_settings_cache()


# ── LLM_FAKE=1 streaming path ──────────────────────────────────────────────

def test_fake_coach_stream_yields_multiple_deltas_and_one_final(
    monkeypatch, _stub_dependencies,
):
    """AR41 + AC2: fake mode produces ≥3 delta frames + one final event."""
    monkeypatch.setenv("LLM_FAKE", "1")
    rows, outcomes = _stub_dependencies

    events = list(stream_complete_sync(
        system="system prompt body", user="user turn",
        purpose="coach", prompt_slug="coach_grounded",
        prompt_version="2.0.0", model=None,
        user_id="user-1", correlation_id="corr-1",
    ))

    deltas = [e for e in events if e.kind == "delta"]
    finals = [e for e in events if e.kind == "final"]
    assert len(deltas) >= 3, "AC2 requires ≥3 token frames in fake mode"
    assert len(finals) == 1, "exactly one final event per call"

    final = finals[0]
    assert final.result is not None
    assert final.result.outcome == "ok"
    assert final.result.model == "fake"
    assert final.result.llm_call_id is not None
    assert final.text  # full text accumulated

    # Metering invariant: exactly ONE llm_calls row.
    assert len(rows) == 1
    assert rows[0]["purpose"] == "coach"
    assert rows[0]["outcome"] == "ok"
    assert rows[0]["model"] == "fake"
    assert rows[0]["row_id"] == final.result.llm_call_id  # same ULID
    assert outcomes == ["ok"]


def test_fake_stream_full_text_concatenates_all_deltas(monkeypatch, _stub_dependencies):
    monkeypatch.setenv("LLM_FAKE", "1")
    events = list(stream_complete_sync(
        system="x", user="y", purpose="coach",
        prompt_slug="coach_grounded", prompt_version="2.0.0",
    ))
    deltas = [e for e in events if e.kind == "delta"]
    finals = [e for e in events if e.kind == "final"]
    delta_text = "".join(d.text for d in deltas)
    # Final event's ``text`` is the FULL accumulated buffer (matches the
    # actor's contract: ``parsed = splitter.finish()`` uses the buffer).
    assert finals[0].text == delta_text


def test_fake_coach_stream_contains_v2_sentinel(monkeypatch, _stub_dependencies):
    """The fake coach stream MUST emit the ``<<<EVIDENCE>>>`` sentinel so
    end-to-end LLM_FAKE=1 dev exercises the splitter + parser. Without
    this, every coach reply lands as ``status="error"`` in fake mode.
    """
    monkeypatch.setenv("LLM_FAKE", "1")
    events = list(stream_complete_sync(
        system="x", user="y", purpose="coach",
        prompt_slug="coach_grounded", prompt_version="2.0.0",
    ))
    final = next(e for e in events if e.kind == "final")
    assert "<<<EVIDENCE>>>" in final.text


# ── pre-call budget exhaustion (un-metered) ────────────────────────────────

def test_budget_exceeded_raises_pre_stream_un_metered(monkeypatch, _stub_dependencies):
    """``check_budget`` raising ``LlmBudgetExceeded`` MUST happen
    BEFORE any delta yields, and MUST NOT write a metering row.
    """
    monkeypatch.setenv("LLM_FAKE", "1")
    rows, outcomes = _stub_dependencies

    from app.llm import budget as _budget  # noqa: PLC0415

    def raise_budget(*, tier, purpose, user_id):
        raise LlmBudgetExceeded(reason="tier_budget", detail="x")

    monkeypatch.setattr(_budget, "check_budget", raise_budget)

    with pytest.raises(LlmBudgetExceeded):
        list(stream_complete_sync(
            system="x", user="y", purpose="coach",
            prompt_slug="coach_grounded", prompt_version="2.0.0",
        ))

    # Pre-call: no row, no outcome recorded.
    assert rows == []
    assert outcomes == []


# ── cancel_check fires terminates iteration after one ``final`` event ──────

def test_cancel_check_does_not_prevent_final_event(monkeypatch, _stub_dependencies):
    """Even when ``cancel_check`` returns ``True`` after the first delta,
    the iterator MUST still terminate with a single ``final`` event so
    the actor's metering / persistence path runs cleanly.

    In fake mode there's no SDK stream to ``close()``, so cancel is a
    semantic no-op; the test asserts the iterator contract holds.
    """
    monkeypatch.setenv("LLM_FAKE", "1")
    events = list(stream_complete_sync(
        system="x", user="y", purpose="coach",
        prompt_slug="coach_grounded", prompt_version="2.0.0",
        cancel_check=lambda: True,
    ))
    finals = [e for e in events if e.kind == "final"]
    assert len(finals) == 1


# ── event-shape sanity ─────────────────────────────────────────────────────

def test_gateway_stream_event_kinds_match_module_constants():
    """If a future refactor renames the event-kind discriminators, this
    test catches it before the actor + tests drift silently."""
    delta = GatewayStreamEvent(kind="delta", text="hi")
    assert delta.kind == "delta"
    final = GatewayStreamEvent(
        kind="final", text="full",
        result=streaming.GatewayResultLike(
            text="full", model="fake",
            input_tokens=0, output_tokens=0, cost_usd=Decimal("0"),
            outcome="ok", latency_ms=0, llm_call_id="llm_X",
        ),
    )
    assert final.kind == "final"
    assert final.result is not None
    assert final.result.llm_call_id == "llm_X"


# ── Story 1.6 code review P15: real SDK close()-on-cancel path ─────────────


def test_real_stream_close_called_when_cancel_check_returns_true(
    monkeypatch, _stub_dependencies,
):
    """The fake-stream path skips the SDK entirely, so the
    ``stream.close()`` codepath at streaming._stream_attempt's cancel
    branch is uncovered. Inject a fake async-iterable that records
    whether ``close()`` was awaited; assert it was.
    """
    # Force the REAL (non-fake) path by disabling LLM_FAKE.
    monkeypatch.delenv("LLM_FAKE", raising=False)
    reset_llm_settings_cache()

    # Drop retry backoff so the test runs instantly.
    monkeypatch.setattr(streaming, "_RETRY_BASE_S", 0)

    close_called = {"value": False}

    class FakeAsyncStream:
        """Mimics ``anthropic.lib.streaming.AsyncMessageStream`` enough
        for the producer's ``async with ... as stream`` + iteration."""
        def __init__(self):
            self.current_message_snapshot = type(
                "Snap", (), {"usage": type("U", (), {
                    "input_tokens": 5, "output_tokens": 3,
                })()},
            )()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        @property
        def text_stream(self):
            async def gen():
                import asyncio as _asyncio  # noqa: PLC0415
                for chunk in ("hello ", "world", " more"):
                    yield chunk
                    # Real Anthropic SDK awaits I/O between chunks
                    # (~10 ms). Mirror that timing so the consumer
                    # thread can race ahead and set cancel_event before
                    # the producer's next iteration check.
                    await _asyncio.sleep(0.05)
            return gen()

        async def close(self):
            close_called["value"] = True

        async def get_final_message(self):
            return self.current_message_snapshot

    class FakeMessages:
        def stream(self, **kwargs):
            return FakeAsyncStream()

    class FakeAsyncAnthropic:
        def __init__(self, *args, **kwargs):
            self.messages = FakeMessages()

        async def aclose(self):
            pass

    monkeypatch.setattr(
        "app.llm.streaming.anthropic.AsyncAnthropic", FakeAsyncAnthropic,
    )

    fired = {"count": 0}

    def cancel_after_first(_unused=None):
        fired["count"] += 1
        return fired["count"] >= 1  # cancel on the very first poll

    events = list(stream_complete_sync(
        system="x", user="y", purpose="coach",
        prompt_slug="coach_grounded", prompt_version="2.0.0",
        model="claude-test", timeout_s=5,
        cancel_check=cancel_after_first,
    ))

    finals = [e for e in events if e.kind == "final"]
    assert len(finals) == 1, "cancel still yields exactly one final event"
    assert close_called["value"], (
        "cancel must call stream.close() on the underlying SDK stream"
    )
