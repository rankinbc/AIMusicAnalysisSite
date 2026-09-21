from app.llm import lane
def test_no_user_keeps_the_default(): assert lane.resolve_lane(None, "free") == "free"
def test_guest_user_rides_the_guest_lane(monkeypatch):
    monkeypatch.setattr(lane, "_lookup_is_guest", lambda uid: True)
    assert lane.resolve_lane("u1", "pro") == lane.GUEST_TIER
def test_real_user_keeps_the_default(monkeypatch):
    monkeypatch.setattr(lane, "_lookup_is_guest", lambda uid: False)
    assert lane.resolve_lane("u1", "pro") == "pro"
def test_lookup_failure_fails_open_to_the_default(monkeypatch):
    def boom(uid): raise RuntimeError("db down")
    monkeypatch.setattr(lane, "_lookup_is_guest", boom)
    assert lane.resolve_lane("u1", "free") == "free"
def test_lookup_is_cached_per_user(monkeypatch):
    calls = []
    monkeypatch.setattr(lane, "_lookup_is_guest", lambda uid: calls.append(uid) or True)
    lane.resolve_lane("u1", "free"); lane.resolve_lane("u1", "free")
    assert calls == ["u1"]
