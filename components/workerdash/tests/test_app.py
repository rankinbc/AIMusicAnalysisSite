import fakeredis
import pytest

from workerdash import wire
from workerdash.app import create_app


class StubConn:  # db failures shouldn't 500 the state endpoint
    def cursor(self):
        raise RuntimeError("db down")


class Ctl:
    def probe(self):
        return {"master": True, "fork": True}

    def derive_status(self, m, f, hb):
        from workerdash.worker_ctl import derive_status
        return derive_status(m, f, hb)

    def restart(self, worker_dir):
        return {"ok": True}


@pytest.fixture
def client():
    r = fakeredis.FakeRedis()
    app = create_app(redis_client=r, db_connect=lambda: StubConn(), ctl=Ctl())
    app.config["TESTING"] = True
    return app.test_client(), r


def test_state_empty_redis_and_dead_db_still_renders(client):
    c, r = client
    res = c.get("/api/state")
    assert res.status_code == 200
    body = res.get_json()
    assert body["worker"]["status"] in ("healthy", "half-dead", "dead")
    assert set(q["name"] for q in body["queues"]) == set(wire.QUEUES)
    assert "error" in body["db"]  # db section degraded, not fatal


def test_cancel_route_removes_message(client):
    c, r = client
    rid = wire.enqueue(r, "run_triage", ["a1"], "analysis-paid")
    res = c.post(f"/api/queue/analysis-paid/{rid}/cancel")
    assert res.get_json()["ok"] is True
    assert wire.list_queue(r, "analysis-paid") == []


def test_cancel_unknown_id_ok_false(client):
    c, r = client
    res = c.post("/api/queue/analysis-paid/nope/cancel")
    assert res.get_json()["ok"] is False


def test_front_route(client):
    c, r = client
    wire.enqueue(r, "x", [], "analysis-paid")
    b = wire.enqueue(r, "y", [], "analysis-paid")
    res = c.post(f"/api/queue/analysis-paid/{b}/front")
    assert res.get_json()["ok"] is True
    assert wire.list_queue(r, "analysis-paid")[0]["redis_message_id"] == b


def test_bad_queue_name_404(client):
    c, r = client
    assert c.post("/api/queue/not-a-queue/x/cancel").status_code == 404


def test_index_serves_html(client):
    c, r = client
    res = c.get("/")
    assert res.status_code == 200
    assert b"workerdash" in res.data


def test_cross_origin_post_rejected(client):
    c, r = client
    rid = wire.enqueue(r, "run_triage", ["a1"], "analysis-paid")
    res = c.post(f"/api/queue/analysis-paid/{rid}/cancel",
                 headers={"Origin": "http://evil.example"})
    assert res.status_code == 403
    assert res.get_json()["ok"] is False


def test_cross_origin_host_rejected(client):
    c, r = client
    res = c.get("/api/state", headers={"Host": "evil.example"})
    assert res.status_code == 403
    assert res.get_json()["ok"] is False


def test_retry_enqueue_failure_reverts_and_returns_error(monkeypatch):
    import workerdash.app as app_module

    class FakeConn:
        def close(self):
            pass

    calls = {"revert": False}
    monkeypatch.setattr(app_module.dbmod, "mark_retry_pending", lambda conn, jid: True)

    def fake_revert(conn, jid):
        calls["revert"] = True
        return True

    monkeypatch.setattr(app_module.dbmod, "revert_retry", fake_revert)

    def fake_enqueue(r, actor, args, queue):
        raise RuntimeError("redis down")

    monkeypatch.setattr(app_module.wire, "enqueue", fake_enqueue)

    rc = fakeredis.FakeRedis()
    app = app_module.create_app(redis_client=rc, db_connect=lambda: FakeConn(), ctl=Ctl())
    app.config["TESTING"] = True
    c = app.test_client()

    res = c.post("/api/jobs/j1/retry")
    body = res.get_json()
    assert body["ok"] is False
    assert "enqueue failed" in body["error"]
    assert calls["revert"] is True
