"""Unit tests for the coach stream publisher (story 1.6 / Task 6.2).

Verifies the wire format published to ``coach:{cid}:{mid}`` is the exact
JSON shape the BFF's SSE relay parses. RedisError must be swallowed —
the persisted ``coach_messages`` row is the system of record; pub/sub
is the ephemeral UX accelerator. A noisy publisher would crash the
actor and leave the row stuck in ``pending``.
"""
from __future__ import annotations

import json
import uuid

import pytest
import redis

from app.coach_lib.stream_publisher import CoachStreamPublisher, reset_client_cache


# ── fake redis recorder ────────────────────────────────────────────────────

class _RecordingRedis:
    def __init__(self, *, raise_on_publish: Exception | None = None):
        self.published: list[tuple[str, str]] = []
        self._raise = raise_on_publish

    def publish(self, channel, payload):
        if self._raise is not None:
            raise self._raise
        self.published.append((channel, payload))


@pytest.fixture
def fake_redis(monkeypatch):
    from app.coach_lib import stream_publisher  # noqa: PLC0415

    fake = _RecordingRedis()
    monkeypatch.setattr(stream_publisher, "_get_client", lambda: fake)
    monkeypatch.setattr(stream_publisher, "_client", fake)
    yield fake
    reset_client_cache()


@pytest.fixture
def cid_mid():
    return uuid.uuid4(), uuid.uuid4()


# ── happy path ─────────────────────────────────────────────────────────────

def test_token_publishes_typed_frame(fake_redis, cid_mid):
    cid, mid = cid_mid
    pub = CoachStreamPublisher(conversation_id=cid, message_id=mid)
    pub.token("hello world")

    assert len(fake_redis.published) == 1
    channel, raw = fake_redis.published[0]
    assert channel == f"coach:{cid}:{mid}"
    frame = json.loads(raw)
    assert frame == {"type": "token", "text": "hello world"}


def test_empty_token_is_skipped(fake_redis, cid_mid):
    """An empty publishable chunk from the splitter MUST NOT generate a
    no-op PUBLISH — the front-end's accumulator would still trigger an
    aria-live announcement on every frame.
    """
    cid, mid = cid_mid
    pub = CoachStreamPublisher(conversation_id=cid, message_id=mid)
    pub.token("")
    assert fake_redis.published == []


def test_done_carries_evidence_list(fake_redis, cid_mid):
    cid, mid = cid_mid
    pub = CoachStreamPublisher(conversation_id=cid, message_id=mid)
    pub.done(evidence=[
        {"label": "LUFS -11.2", "path": "phase1.lufs_integrated"},
    ])

    frame = json.loads(fake_redis.published[0][1])
    assert frame["type"] == "done"
    assert frame["evidence"] == [
        {"label": "LUFS -11.2", "path": "phase1.lufs_integrated"},
    ]


def test_refusal_carries_reason_and_body(fake_redis, cid_mid):
    cid, mid = cid_mid
    pub = CoachStreamPublisher(conversation_id=cid, message_id=mid)
    pub.refusal(reason="missing_data", body="No stems uploaded.")

    frame = json.loads(fake_redis.published[0][1])
    assert frame == {
        "type": "refusal",
        "reason": "missing_data",
        "body": "No stems uploaded.",
    }


def test_error_carries_code_and_message(fake_redis, cid_mid):
    cid, mid = cid_mid
    pub = CoachStreamPublisher(conversation_id=cid, message_id=mid)
    pub.error(code="coach_offline", message="Coach is offline.")

    frame = json.loads(fake_redis.published[0][1])
    assert frame == {
        "type": "error",
        "code": "coach_offline",
        "message": "Coach is offline.",
    }


# ── failure mode: RedisError swallowed ─────────────────────────────────────

def test_redis_error_is_swallowed_not_raised(monkeypatch, caplog, cid_mid):
    """A dead broker must not crash the actor mid-Phase-G. The persisted
    row is the durable contract; pub/sub is the ephemeral accelerator.
    """
    from app.coach_lib import stream_publisher  # noqa: PLC0415

    fake = _RecordingRedis(
        raise_on_publish=redis.RedisError("connection refused"),
    )
    monkeypatch.setattr(stream_publisher, "_get_client", lambda: fake)
    monkeypatch.setattr(stream_publisher, "_client", fake)

    cid, mid = cid_mid
    pub = CoachStreamPublisher(conversation_id=cid, message_id=mid)
    pub.token("anything")  # MUST NOT raise


def test_unexpected_exception_is_swallowed_not_raised(monkeypatch, cid_mid):
    """Defence in depth — a future JSON-encoding bug must not escape."""
    from app.coach_lib import stream_publisher  # noqa: PLC0415

    fake = _RecordingRedis(raise_on_publish=ValueError("encoding"))
    monkeypatch.setattr(stream_publisher, "_get_client", lambda: fake)
    monkeypatch.setattr(stream_publisher, "_client", fake)

    cid, mid = cid_mid
    pub = CoachStreamPublisher(conversation_id=cid, message_id=mid)
    pub.token("anything")  # MUST NOT raise


def test_channel_format_is_lowercase_no_braces(fake_redis):
    """Channel = ``coach:{cid_str}:{mid_str}`` — lowercase, no braces,
    matches the worker's docstring + the BFF subscriber."""
    cid = uuid.UUID("00000000-1111-2222-3333-444444444444")
    mid = uuid.UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    pub = CoachStreamPublisher(conversation_id=cid, message_id=mid)
    pub.token("x")
    channel, _raw = fake_redis.published[0]
    assert channel == (
        "coach:00000000-1111-2222-3333-444444444444:"
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    )
