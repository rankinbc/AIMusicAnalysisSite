import json

from workerdash.wire import build_envelope, parse_envelope


def test_build_envelope_matches_dramatiq_contract():
    rid, payload = build_envelope("analyze_audio_job", ["abc-123"], "analysis-paid")
    m = json.loads(payload)
    assert m["queue_name"] == "analysis-paid"
    assert m["actor_name"] == "analyze_audio_job"
    assert m["args"] == ["abc-123"]
    assert m["kwargs"] == {}
    # CRITICAL invariant: worker acks via options.redis_message_id
    assert m["options"]["redis_message_id"] == rid
    assert m["message_id"] != rid  # separate actor-visible id
    assert isinstance(m["message_timestamp"], int)


def test_parse_envelope_round_trip():
    rid, payload = build_envelope("run_triage", ["a1"], "analysis-paid")
    p = parse_envelope(payload)
    assert p["actor_name"] == "run_triage"
    assert p["args"] == ["a1"]
    assert p["redis_message_id"] == rid
    assert p["queue_name"] == "analysis-paid"


def test_parse_envelope_bad_json_returns_error_not_raise():
    p = parse_envelope(b"{not json")
    assert "parse_error" in p
    assert p["raw"].startswith("{not json")
