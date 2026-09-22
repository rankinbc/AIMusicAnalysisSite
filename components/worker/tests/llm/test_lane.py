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
def test_purged_user_no_row_rides_the_guest_lane(monkeypatch):
    # M7 — a user id that resolves to NO row (account purged while its work
    # was still queued) must never bill the real-user free/pro lane or its
    # global spend sum. `_lookup_is_guest` signals "no row" with `None`
    # (distinct from a lookup EXCEPTION, which still fails open to `default`).
    monkeypatch.setattr(lane, "_lookup_is_guest", lambda uid: None)
    assert lane.resolve_lane("u1", "pro") == lane.GUEST_TIER
