"""Pure decision logic for the worker watchdog. The loop itself (process
probing, relaunching) is subprocess-based and manually tested, like
worker_ctl's probe/restart."""
from workerdash.watchdog import CRASH_LOOP_MAX, CRASH_LOOP_WINDOW_S, decide


def test_healthy_never_restarts():
    d = decide(["healthy", "healthy"], restart_times=[], now=1000.0)
    assert d.action == "ok"


def test_single_bad_check_waits():
    # One bad probe can be a race (mid-restart, slow heartbeat write) — the
    # watchdog needs two consecutive bad checks before acting.
    d = decide(["healthy", "dead"], restart_times=[], now=1000.0)
    assert d.action == "wait"


def test_two_consecutive_dead_restarts():
    d = decide(["dead", "dead"], restart_times=[], now=1000.0)
    assert d.action == "restart"


def test_two_consecutive_half_dead_restarts():
    d = decide(["half-dead", "half-dead"], restart_times=[], now=1000.0)
    assert d.action == "restart"


def test_mixed_bad_statuses_restart():
    d = decide(["dead", "half-dead"], restart_times=[], now=1000.0)
    assert d.action == "restart"


def test_crash_loop_halts():
    now = 1000.0
    recent = [now - 30, now - 200, now - 400]  # 3 restarts inside the window
    assert len(recent) == CRASH_LOOP_MAX
    d = decide(["dead", "dead"], restart_times=recent, now=now)
    assert d.action == "halt"


def test_old_restarts_fall_out_of_window():
    now = 10_000.0
    old = [now - CRASH_LOOP_WINDOW_S - 5, now - CRASH_LOOP_WINDOW_S - 500, now - 60]
    d = decide(["dead", "dead"], restart_times=old, now=now)
    assert d.action == "restart"  # only 1 restart still inside the window


def test_state_includes_watchdog_status(tmp_path, monkeypatch):
    import json
    import time

    import fakeredis

    from workerdash.app import create_app

    sf = tmp_path / "watchdog-status.json"
    sf.write_text(json.dumps({"ts": time.time(), "status": "dead",
                              "action": "halt", "halted": True,
                              "restarts_in_window": 3}))
    monkeypatch.setenv("WATCHDOG_STATUS_FILE", str(sf))

    class Ctl:
        def probe(self):
            return {"master": True, "fork": True}

        def derive_status(self, m, f, hb):
            return "healthy"

    class StubConn:
        def cursor(self):
            raise RuntimeError("db down")

    app = create_app(redis_client=fakeredis.FakeRedis(),
                     db_connect=lambda: StubConn(), ctl=Ctl())
    app.config["TESTING"] = True
    body = app.test_client().get("/api/state").get_json()
    assert body["worker"]["watchdog"] == {"halted": True, "action": "halt",
                                          "restarts_in_window": 3}


def test_state_watchdog_none_when_status_stale(tmp_path, monkeypatch):
    import json

    import fakeredis

    from workerdash.app import create_app

    sf = tmp_path / "watchdog-status.json"
    sf.write_text(json.dumps({"ts": 1.0, "status": "dead", "halted": False}))
    monkeypatch.setenv("WATCHDOG_STATUS_FILE", str(sf))

    class Ctl:
        def probe(self):
            return {"master": True, "fork": True}

        def derive_status(self, m, f, hb):
            return "healthy"

    class StubConn:
        def cursor(self):
            raise RuntimeError("db down")

    app = create_app(redis_client=fakeredis.FakeRedis(),
                     db_connect=lambda: StubConn(), ctl=Ctl())
    app.config["TESTING"] = True
    body = app.test_client().get("/api/state").get_json()
    assert body["worker"]["watchdog"] is None


def test_watchdog_relaunches_one_logged_worker_per_pool(tmp_path, monkeypatch):
    from workerdash import watchdog, worker_ctl
    calls = []
    monkeypatch.setattr(watchdog.subprocess, "run",
                        lambda args, **kw: calls.append(args[-1]))
    watchdog.launch_worker_logged(str(tmp_path), str(tmp_path / "logs"))
    assert len(calls) == len(worker_ctl.WORKER_POOLS)
    assert any("'--queues','coach'" in c and "analysis-paid" not in c for c in calls)
