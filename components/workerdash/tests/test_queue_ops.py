import fakeredis
import pytest

from workerdash.wire import (
    bring_to_front, cancel_message, enqueue, heartbeat_age_seconds,
    list_queue, msgs_key, queue_key,
)


@pytest.fixture
def r():
    return fakeredis.FakeRedis()


def test_enqueue_then_list_preserves_order(r):
    a = enqueue(r, "analyze_audio_job", ["j1"], "analysis-paid")
    b = enqueue(r, "run_triage", ["a1"], "analysis-paid")
    rows = list_queue(r, "analysis-paid")
    assert [x["redis_message_id"] for x in rows] == [a, b]
    assert rows[0]["position"] == 0 and rows[1]["position"] == 1
    assert r.llen(queue_key("analysis-paid")) == 2
    assert r.hlen(msgs_key("analysis-paid")) == 2


def test_cancel_removes_from_list_and_hash(r):
    a = enqueue(r, "run_triage", ["a1"], "analysis-paid")
    assert cancel_message(r, "analysis-paid", a) is True
    assert r.llen(queue_key("analysis-paid")) == 0
    assert r.hlen(msgs_key("analysis-paid")) == 0


def test_cancel_unknown_id_is_noop_false(r):
    enqueue(r, "run_triage", ["a1"], "analysis-paid")
    assert cancel_message(r, "analysis-paid", "nope") is False
    assert r.llen(queue_key("analysis-paid")) == 1


def test_bring_to_front_moves_to_head(r):
    a = enqueue(r, "x", [], "analysis-paid")
    b = enqueue(r, "y", [], "analysis-paid")
    c = enqueue(r, "z", [], "analysis-paid")
    assert bring_to_front(r, "analysis-paid", c) is True
    rows = list_queue(r, "analysis-paid")
    assert [x["redis_message_id"] for x in rows] == [c, a, b]


def test_bring_to_front_unknown_id_is_noop_false(r):
    a = enqueue(r, "x", [], "analysis-paid")
    assert bring_to_front(r, "analysis-paid", "ghost") is False
    rows = list_queue(r, "analysis-paid")
    assert [x["redis_message_id"] for x in rows] == [a]  # no phantom entry


def test_list_queue_orphan_id_renders_error_row(r):
    r.rpush(queue_key("analysis-paid"), "ghost")
    rows = list_queue(r, "analysis-paid")
    assert rows[0]["redis_message_id"] == "ghost"
    assert "parse_error" in rows[0]


def test_heartbeat_age(r):
    assert heartbeat_age_seconds(r) is None
    import time
    r.zadd("dramatiq:__heartbeats__", {"w1": int(time.time() * 1000) - 5000})
    age = heartbeat_age_seconds(r)
    assert 4 <= age <= 7
